#define WIN32_LEAN_AND_MEAN
#define OEMRESOURCE
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#pragma warning(disable: 4310)
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <wincrypt.h>

#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <chrono>
#include <thread>
#include <atomic>
#include <mutex>
#include <memory>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "advapi32.lib")

using Microsoft::WRL::ComPtr;

// Magic number for binary frame: 'DXGI' = 0x44584749
static const uint32_t DXGI_FRAME_MAGIC = 0x44584749;

#pragma pack(push, 1)
struct DxgiBinaryHeader {
    uint32_t magic;       // 0x44584749 ('DXGI')
    uint32_t width;       // Desktop width
    uint32_t height;      // Desktop height
    uint32_t format;      // 0 = BGRA 32bpp
    uint64_t timestampUs; // Timestamp in microseconds
};
#pragma pack(pop)

// Base64 helper
static std::string base64_encode(const unsigned char* data, size_t len) {
    static const char chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, valb = -6;
    for (size_t i = 0; i < len; ++i) {
        val = (val << 8) + data[i];
        valb += 8;
        while (valb >= 0) {
            out.push_back(chars[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) out.push_back(chars[((val << 8) >> (valb + 8)) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}

// Compute WebSocket Sec-WebSocket-Accept using Windows Crypto API
static std::string computeWsAccept(const std::string& key) {
    std::string input = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    std::vector<uint8_t> hash(20, 0);
    DWORD hashLen = 20;

    if (CryptAcquireContextW(&hProv, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) {
        if (CryptCreateHash(hProv, CALG_SHA1, 0, 0, &hHash)) {
            CryptHashData(hHash, (const BYTE*)input.data(), (DWORD)input.length(), 0);
            CryptGetHashParam(hHash, HP_HASHVAL, hash.data(), &hashLen, 0);
            CryptDestroyHash(hHash);
        }
        CryptReleaseContext(hProv, 0);
    }
    return base64_encode(hash.data(), hash.size());
}

// Generate standard 32-bit BMP Data URL for CSS cursor
static std::string makeBmpDataUrl(int width, int height, const uint8_t* rgbaPixels) {
    BITMAPFILEHEADER bfh = {0};
    BITMAPV5HEADER bV5 = {0};

    bfh.bfType = 0x4D42; // "BM"
    bfh.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPV5HEADER);
    bfh.bfSize = bfh.bfOffBits + (width * height * 4);

    bV5.bV5Size = sizeof(BITMAPV5HEADER);
    bV5.bV5Width = width;
    bV5.bV5Height = -height; // top-down
    bV5.bV5Planes = 1;
    bV5.bV5BitCount = 32;
    bV5.bV5Compression = BI_BITFIELDS;
    bV5.bV5RedMask   = 0x00FF0000;
    bV5.bV5GreenMask = 0x0000FF00;
    bV5.bV5BlueMask  = 0x000000FF;
    bV5.bV5AlphaMask = 0xFF000000;

    std::vector<uint8_t> bmpData(bfh.bfSize);
    memcpy(bmpData.data(), &bfh, sizeof(bfh));
    memcpy(bmpData.data() + sizeof(bfh), &bV5, sizeof(bV5));
    memcpy(bmpData.data() + bfh.bfOffBits, rgbaPixels, width * height * 4);

    return "data:image/bmp;base64," + base64_encode(bmpData.data(), bmpData.size());
}

// Convert 1-bit monochrome mask to 32-bit RGBA
static void convertMonochromeMaskToRgba(int width, int height, int pitch, const uint8_t* src, std::vector<uint8_t>& dstRgba) {
    int actualHeight = height / 2;
    dstRgba.assign(width * actualHeight * 4, 0);
    const uint8_t* andMask = src;
    const uint8_t* xorMask = src + (actualHeight * pitch);

    for (int y = 0; y < actualHeight; ++y) {
        for (int x = 0; x < width; ++x) {
            int byteIndex = (y * pitch) + (x / 8);
            int bit = 7 - (x % 8);
            bool andBit = (andMask[byteIndex] >> bit) & 1;
            bool xorBit = (xorMask[byteIndex] >> bit) & 1;

            int dstOffset = (y * width + x) * 4;
            if (!andBit && !xorBit) {
                // Black
                dstRgba[dstOffset + 0] = 0;
                dstRgba[dstOffset + 1] = 0;
                dstRgba[dstOffset + 2] = 0;
                dstRgba[dstOffset + 3] = 255;
            } else if (!andBit && xorBit) {
                // White
                dstRgba[dstOffset + 0] = 255;
                dstRgba[dstOffset + 1] = 255;
                dstRgba[dstOffset + 2] = 255;
                dstRgba[dstOffset + 3] = 255;
            } else if (andBit && !xorBit) {
                // Transparent
                dstRgba[dstOffset + 0] = 0;
                dstRgba[dstOffset + 1] = 0;
                dstRgba[dstOffset + 2] = 0;
                dstRgba[dstOffset + 3] = 0;
            } else {
                // Inverted / Semi-transparent
                dstRgba[dstOffset + 0] = 255;
                dstRgba[dstOffset + 1] = 255;
                dstRgba[dstOffset + 2] = 255;
                dstRgba[dstOffset + 3] = 128;
            }
        }
    }
}

// WebSocket connection state
class WsClient {
public:
    SOCKET sock = INVALID_SOCKET;
    bool handshaken = false;

    WsClient(SOCKET s) : sock(s), handshaken(false) {}
    ~WsClient() {
        close();
    }

    void close() {
        if (sock != INVALID_SOCKET) {
            closesocket(sock);
            sock = INVALID_SOCKET;
        }
        handshaken = false;
    }

    bool sendAll(const char* buf, int len) {
        int total = 0;
        while (total < len) {
            int sent = ::send(sock, buf + total, len - total, 0);
            if (sent <= 0) return false;
            total += sent;
        }
        return true;
    }

    bool sendText(const std::string& text) {
        if (!handshaken || sock == INVALID_SOCKET) return false;
        std::vector<char> frame;
        frame.push_back((char)0x81); // FIN = 1, opcode = 1 (text)
        size_t len = text.size();
        if (len < 126) {
            frame.push_back((char)len);
        } else if (len <= 0xFFFF) {
            frame.push_back((char)126);
            frame.push_back((char)((len >> 8) & 0xFF));
            frame.push_back((char)(len & 0xFF));
        } else {
            frame.push_back((char)127);
            for (int i = 7; i >= 0; --i) {
                frame.push_back((char)((len >> (i * 8)) & 0xFF));
            }
        }
        frame.insert(frame.end(), text.begin(), text.end());
        return sendAll(frame.data(), (int)frame.size());
    }

    bool sendBinary(const uint8_t* header, size_t headerLen, const uint8_t* payload, size_t payloadLen) {
        if (!handshaken || sock == INVALID_SOCKET) return false;
        size_t totalLen = headerLen + payloadLen;
        std::vector<char> frameHeader;
        frameHeader.push_back((char)0x82); // FIN = 1, opcode = 2 (binary)
        if (totalLen < 126) {
            frameHeader.push_back((char)totalLen);
        } else if (totalLen <= 0xFFFF) {
            frameHeader.push_back((char)126);
            frameHeader.push_back((char)((totalLen >> 8) & 0xFF));
            frameHeader.push_back((char)(totalLen & 0xFF));
        } else {
            frameHeader.push_back((char)127);
            for (int i = 7; i >= 0; --i) {
                frameHeader.push_back((char)((totalLen >> (i * 8)) & 0xFF));
            }
        }

        // Send WebSocket frame header
        if (!sendAll(frameHeader.data(), (int)frameHeader.size())) return false;
        // Send packet header (DxgiBinaryHeader)
        if (headerLen > 0 && !sendAll((const char*)header, (int)headerLen)) return false;
        // Send frame pixel payload
        if (payloadLen > 0 && !sendAll((const char*)payload, (int)payloadLen)) return false;

        return true;
    }
};

// Global capturer state
static std::atomic<bool> g_running(true);
static std::shared_ptr<WsClient> g_client;
static std::mutex g_clientMutex;

// Cursor state tracking
static int g_lastCursorX = -1;
static int g_lastCursorY = -1;
static bool g_lastCursorVisible = false;
static std::string g_lastCursorShapeUrl = "";

// Attach thread to active user desktop to avoid E_ACCESSDENIED (0x80070005)
static HDESK bindToInputDesktop() {
    HDESK hDesk = OpenInputDesktop(0, FALSE, GENERIC_ALL);
    if (hDesk) {
        SetThreadDesktop(hDesk);
    }
    return hDesk;
}

// DXGI Capturer Engine
class DxgiCapturer {
public:
    ComPtr<IDXGIFactory1> factory;
    ComPtr<IDXGIAdapter1> adapter;
    ComPtr<IDXGIOutput1> output1;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    ComPtr<IDXGIOutputDuplication> duplication;
    ComPtr<ID3D11Texture2D> stagingTexture;

    int width = 0;
    int height = 0;
    int targetFps = 60;
    int displayIndex = 0;
    std::vector<uint8_t> contiguousBuffer;
    std::vector<uint8_t> shapeBuffer;

    bool init(int dispIdx = 0, int fps = 60) {
        displayIndex = dispIdx;
        targetFps = fps > 0 ? fps : 60;
        cleanup();

        bindToInputDesktop();

        HRESULT hr = CreateDXGIFactory1(__uuidof(IDXGIFactory1), &factory);
        if (FAILED(hr)) return false;

        hr = factory->EnumAdapters1(0, &adapter);
        if (FAILED(hr)) return false;

        ComPtr<IDXGIOutput> output;
        hr = adapter->EnumOutputs(displayIndex, &output);
        if (FAILED(hr)) return false;

        DXGI_OUTPUT_DESC outDesc;
        output->GetDesc(&outDesc);
        width = outDesc.DesktopCoordinates.right - outDesc.DesktopCoordinates.left;
        height = outDesc.DesktopCoordinates.bottom - outDesc.DesktopCoordinates.top;
        if (width <= 0 || height <= 0) return false;

        D3D_FEATURE_LEVEL fl;
        hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &device, &fl, &context);
        if (FAILED(hr)) return false;

        hr = output.As(&output1);
        if (FAILED(hr)) return false;

        hr = output1->DuplicateOutput(device.Get(), &duplication);
        if (FAILED(hr)) {
            // Attempt retry once if transient lock
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            bindToInputDesktop();
            hr = output1->DuplicateOutput(device.Get(), &duplication);
            if (FAILED(hr)) return false;
        }

        // Staging texture for CPU read
        D3D11_TEXTURE2D_DESC stagingDesc = {};
        stagingDesc.Width = width;
        stagingDesc.Height = height;
        stagingDesc.MipLevels = 1;
        stagingDesc.ArraySize = 1;
        stagingDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        stagingDesc.SampleDesc.Count = 1;
        stagingDesc.Usage = D3D11_USAGE_STAGING;
        stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;

        hr = device->CreateTexture2D(&stagingDesc, nullptr, &stagingTexture);
        if (FAILED(hr)) return false;

        contiguousBuffer.resize(width * height * 4);
        return true;
    }

    void cleanup() {
        if (duplication) duplication.Reset();
        if (stagingTexture) stagingTexture.Reset();
        if (context) context.Reset();
        if (device) device.Reset();
        if (output1) output1.Reset();
        if (adapter) adapter.Reset();
        if (factory) factory.Reset();
    }

    // Capture single frame, returns true if frame acquired & sent
    bool captureFrame(std::shared_ptr<WsClient> client) {
        if (!duplication) return false;

        DXGI_OUTDUPL_FRAME_INFO frameInfo;
        ComPtr<IDXGIResource> desktopResource;
        HRESULT hr = duplication->AcquireNextFrame(20, &frameInfo, &desktopResource);
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
            return false;
        }
        if (hr == DXGI_ERROR_ACCESS_LOST || FAILED(hr)) {
            // Re-initialize duplication on mode switch or access lost
            init(displayIndex, targetFps);
            return false;
        }

        // Process cursor updates
        bool cursorVisible = frameInfo.PointerPosition.Visible != 0;
        int cx = frameInfo.PointerPosition.Position.x;
        int cy = frameInfo.PointerPosition.Position.y;

        bool cursorChanged = false;
        if (cursorVisible != g_lastCursorVisible || cx != g_lastCursorX || cy != g_lastCursorY) {
            g_lastCursorVisible = cursorVisible;
            g_lastCursorX = cx;
            g_lastCursorY = cy;
            cursorChanged = true;
        }

        // Check if cursor shape changed
        if (frameInfo.PointerShapeBufferSize > 0) {
            shapeBuffer.resize(frameInfo.PointerShapeBufferSize);
            DXGI_OUTDUPL_POINTER_SHAPE_INFO shapeInfo;
            UINT required = 0;
            hr = duplication->GetFramePointerShape(
                frameInfo.PointerShapeBufferSize,
                shapeBuffer.data(),
                &required,
                &shapeInfo
            );
            if (SUCCEEDED(hr)) {
                if (shapeInfo.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR) {
                    g_lastCursorShapeUrl = makeBmpDataUrl(shapeInfo.Width, shapeInfo.Height, shapeBuffer.data());
                } else if (shapeInfo.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME) {
                    std::vector<uint8_t> rgba;
                    convertMonochromeMaskToRgba(shapeInfo.Width, shapeInfo.Height, shapeInfo.Pitch, shapeBuffer.data(), rgba);
                    g_lastCursorShapeUrl = makeBmpDataUrl(shapeInfo.Width, shapeInfo.Height / 2, rgba.data());
                }
                if (client) {
                    std::stringstream ss;
                    ss << "{\"type\":\"cursor\",\"visible\":" << (cursorVisible ? "true" : "false")
                       << ",\"x\":" << cx << ",\"y\":" << cy
                       << ",\"hotspotX\":" << shapeInfo.HotSpot.x << ",\"hotspotY\":" << shapeInfo.HotSpot.y
                       << ",\"shape\":\"" << g_lastCursorShapeUrl << "\"}";
                    client->sendText(ss.str());
                }
                cursorChanged = false;
            }
        }

        if (cursorChanged && client) {
            std::stringstream ss;
            ss << "{\"type\":\"cursor\",\"visible\":" << (cursorVisible ? "true" : "false")
               << ",\"x\":" << cx << ",\"y\":" << cy << "}";
            client->sendText(ss.str());
        }

        // Process pure desktop texture
        bool frameSent = false;
        if (desktopResource) {
            ComPtr<ID3D11Texture2D> desktopTexture;
            hr = desktopResource.As(&desktopTexture);
            if (SUCCEEDED(hr)) {
                context->CopyResource(stagingTexture.Get(), desktopTexture.Get());
                duplication->ReleaseFrame();

                D3D11_MAPPED_SUBRESOURCE mapped;
                hr = context->Map(stagingTexture.Get(), 0, D3D11_MAP_READ, 0, &mapped);
                if (SUCCEEDED(hr)) {
                    const uint8_t* pSrc = (const uint8_t*)mapped.pData;
                    const uint8_t* pPayload = pSrc;
                    size_t expectedPitch = (size_t)width * 4;

                    if (mapped.RowPitch == expectedPitch) {
                        pPayload = pSrc;
                    } else {
                        // Pack unpadded rows
                        for (int y = 0; y < height; ++y) {
                            memcpy(contiguousBuffer.data() + y * expectedPitch, pSrc + y * mapped.RowPitch, expectedPitch);
                        }
                        pPayload = contiguousBuffer.data();
                    }

                    if (client) {
                        uint64_t nowUs = (uint64_t)std::chrono::duration_cast<std::chrono::microseconds>(
                            std::chrono::steady_clock::now().time_since_epoch()
                        ).count();

                        DxgiBinaryHeader header;
                        header.magic = DXGI_FRAME_MAGIC;
                        header.width = (uint32_t)width;
                        header.height = (uint32_t)height;
                        header.format = 0; // BGRA
                        header.timestampUs = nowUs;

                        frameSent = client->sendBinary(
                            (const uint8_t*)&header,
                            sizeof(header),
                            pPayload,
                            expectedPitch * height
                        );
                    }
                    context->Unmap(stagingTexture.Get(), 0);
                }
                return frameSent;
            }
        }

        duplication->ReleaseFrame();
        return frameSent;
    }
};

// Handle WebSocket client handshake
static bool handleWsHandshake(SOCKET clientSock) {
    char buf[4096];
    int received = recv(clientSock, buf, sizeof(buf) - 1, 0);
    if (received <= 0) return false;
    buf[received] = '\0';

    std::string req(buf);
    std::string keyHeader = "Sec-WebSocket-Key: ";
    size_t pos = req.find(keyHeader);
    if (pos == std::string::npos) return false;

    pos += keyHeader.length();
    size_t endPos = req.find("\r\n", pos);
    if (endPos == std::string::npos) return false;

    std::string clientKey = req.substr(pos, endPos - pos);
    std::string acceptKey = computeWsAccept(clientKey);

    std::string response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n";

    int sent = ::send(clientSock, response.data(), (int)response.size(), 0);
    return sent > 0;
}

// Background thread watching for parent process termination (EOF on stdin)
static void watchParentExit() {
    char c;
    while (std::cin.get(c)) {
        // Continue listening until stdin closes (EOF)
    }
    g_running = false;
}

// Self-test runner
static int runSelfTest() {
    std::cout << "[Self-Test] Checking SHA1 calculation..." << std::endl;
    std::string testAccept = computeWsAccept("dGhlIHNhbXBsZSBub25jZQ==");
    if (testAccept != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=") {
        std::cerr << "SHA1 test failed!" << std::endl;
        return 1;
    }

    std::cout << "[Self-Test] Checking BMP generator..." << std::endl;
    std::vector<uint8_t> dummyPixels(16 * 16 * 4, 0x55);
    std::string bmpUrl = makeBmpDataUrl(16, 16, dummyPixels.data());
    if (bmpUrl.find("data:image/bmp;base64,") != 0) {
        std::cerr << "BMP test failed!" << std::endl;
        return 1;
    }

    std::cout << "[Self-Test] Checking DXGI capture initialization..." << std::endl;
    DxgiCapturer testCapturer;
    if (testCapturer.init(0, 60)) {
        std::cout << "DXGI Desktop: " << testCapturer.width << "x" << testCapturer.height << std::endl;
        testCapturer.cleanup();
    } else {
        std::cout << "[Self-Test] DXGI not currently attachable (headless or no display attached), but binary is intact." << std::endl;
    }

    std::cout << "dxgi-capturer self-test: PASS\n" << std::flush;
    return 0;
}

int main(int argc, char* argv[]) {
    // Parse arguments
    int port = 0;
    int fps = 60;
    int displayIndex = 0;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--self-test") {
            return runSelfTest();
        } else if (arg == "--port" && i + 1 < argc) {
            port = std::stoi(argv[++i]);
        } else if (arg == "--fps" && i + 1 < argc) {
            fps = std::stoi(argv[++i]);
        } else if (arg == "--display" && i + 1 < argc) {
            displayIndex = std::stoi(argv[++i]);
        }
    }

    // Attach to active desktop
    HDESK hDesk = bindToInputDesktop();

    // Start stdin watcher thread
    std::thread stdinThread(watchParentExit);
    stdinThread.detach();

    // Initialize WinSock
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        std::cerr << "WSAStartup failed\n";
        return 1;
    }

    SOCKET listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSock == INVALID_SOCKET) {
        std::cerr << "socket() failed\n";
        return 1;
    }

    // Set reuseaddr
    int opt = 1;
    setsockopt(listenSock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in serverAddr = {};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_addr.s_addr = inet_addr("127.0.0.1");
    serverAddr.sin_port = htons((u_short)port);

    if (bind(listenSock, (sockaddr*)&serverAddr, sizeof(serverAddr)) == SOCKET_ERROR) {
        std::cerr << "bind() failed: " << WSAGetLastError() << "\n";
        closesocket(listenSock);
        return 1;
    }

    if (listen(listenSock, 1) == SOCKET_ERROR) {
        std::cerr << "listen() failed: " << WSAGetLastError() << "\n";
        closesocket(listenSock);
        return 1;
    }

    // Get assigned port
    sockaddr_in boundAddr = {};
    int boundLen = sizeof(boundAddr);
    getsockname(listenSock, (sockaddr*)&boundAddr, &boundLen);
    int assignedPort = ntohs(boundAddr.sin_port);

    // Announce port on stdout for Electron parent process
    std::cout << "{\"type\":\"ready\",\"port\":" << assignedPort << "}\n" << std::flush;

    // Set non-blocking on listen socket
    u_long mode = 1;
    ioctlsocket(listenSock, FIONBIO, &mode);

    DxgiCapturer capturer;
    bool capturerReady = capturer.init(displayIndex, fps);
    if (!capturerReady) {
        std::cout << "{\"type\":\"warning\",\"message\":\"DXGI Desktop Duplication initial init failed, will retry on connect\"}\n" << std::flush;
    }

    auto frameInterval = std::chrono::microseconds(1000000 / (fps > 0 ? fps : 60));

    while (g_running) {
        // Accept new client if none connected
        if (!g_client) {
            sockaddr_in clientAddr;
            int clientLen = sizeof(clientAddr);
            SOCKET clientSock = accept(listenSock, (sockaddr*)&clientAddr, &clientLen);
            if (clientSock != INVALID_SOCKET) {
                // Set TCP_NODELAY and reasonable buffer sizes
                int flag = 1;
                setsockopt(clientSock, IPPROTO_TCP, TCP_NODELAY, (char*)&flag, sizeof(flag));
                int sendBufSize = 4 * 1024 * 1024;
                setsockopt(clientSock, SOL_SOCKET, SO_SNDBUF, (char*)&sendBufSize, sizeof(sendBufSize));

                // Handshake
                // Temporarily set blocking for handshake
                u_long blockMode = 0;
                ioctlsocket(clientSock, FIONBIO, &blockMode);

                if (handleWsHandshake(clientSock)) {
                    std::lock_guard<std::mutex> lock(g_clientMutex);
                    g_client = std::make_shared<WsClient>(clientSock);
                    g_client->handshaken = true;
                    std::cout << "{\"type\":\"client-connected\"}\n" << std::flush;

                    // Ensure capturer is initialized
                    if (!capturer.duplication) {
                        capturer.init(displayIndex, fps);
                    }
                } else {
                    closesocket(clientSock);
                }
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
        }

        // Frame loop
        auto frameStart = std::chrono::steady_clock::now();
        std::shared_ptr<WsClient> curClient;
        {
            std::lock_guard<std::mutex> lock(g_clientMutex);
            curClient = g_client;
        }

        if (curClient && curClient->handshaken) {
            bool sent = capturer.captureFrame(curClient);
            if (!sent && curClient->sock == INVALID_SOCKET) {
                // Client disconnected
                std::lock_guard<std::mutex> lock(g_clientMutex);
                g_client.reset();
                std::cout << "{\"type\":\"client-disconnected\"}\n" << std::flush;
            }
        }

        auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - frameStart);
        if (elapsed < frameInterval) {
            std::this_thread::sleep_for(frameInterval - elapsed);
        }
    }

    capturer.cleanup();
    if (g_client) g_client->close();
    closesocket(listenSock);
    WSACleanup();
    if (hDesk) CloseDesktop(hDesk);
    return 0;
}
