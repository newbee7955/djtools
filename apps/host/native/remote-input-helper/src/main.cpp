#define OEMRESOURCE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <set>
#include <chrono>
#include <cmath>
#include <map>

// Lightweight JSON field extraction helpers
static std::string extractString(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.length();
    size_t endPos = json.find("\"", pos);
    if (endPos == std::string::npos) return "";
    return json.substr(pos, endPos - pos);
}

static double extractDouble(const std::string& json, const std::string& key, double defaultValue = 0.0) {
    std::string search = "\"" + key + "\":";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return defaultValue;
    pos += search.length();
    while (pos < json.length() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    try {
        return std::stod(json.substr(pos));
    } catch (...) {
        return defaultValue;
    }
}

static bool extractBool(const std::string& json, const std::string& key, bool defaultValue = false) {
    std::string search = "\"" + key + "\":";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return defaultValue;
    pos += search.length();
    while (pos < json.length() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (json.compare(pos, 4, "true") == 0) return true;
    if (json.compare(pos, 5, "false") == 0) return false;
    return defaultValue;
}

// Map DOM key code to Win32 Virtual-Key Code
static WORD mapDomCodeToVk(const std::string& code) {
    static const std::map<std::string, WORD> keyMap = {
        {"KeyA", 'A'}, {"KeyB", 'B'}, {"KeyC", 'C'}, {"KeyD", 'D'}, {"KeyE", 'E'},
        {"KeyF", 'F'}, {"KeyG", 'G'}, {"KeyH", 'H'}, {"KeyI", 'I'}, {"KeyJ", 'J'},
        {"KeyK", 'K'}, {"KeyL", 'L'}, {"KeyM", 'M'}, {"KeyN", 'N'}, {"KeyO", 'O'},
        {"KeyP", 'P'}, {"KeyQ", 'Q'}, {"KeyR", 'R'}, {"KeyS", 'S'}, {"KeyT", 'T'},
        {"KeyU", 'U'}, {"KeyV", 'V'}, {"KeyW", 'W'}, {"KeyX", 'X'}, {"KeyY", 'Y'}, {"KeyZ", 'Z'},
        {"Digit0", '0'}, {"Digit1", '1'}, {"Digit2", '2'}, {"Digit3", '3'}, {"Digit4", '4'},
        {"Digit5", '5'}, {"Digit6", '6'}, {"Digit7", '7'}, {"Digit8", '8'}, {"Digit9", '9'},
        {"Enter", VK_RETURN}, {"NumpadEnter", VK_RETURN},
        {"Escape", VK_ESCAPE},
        {"Backspace", VK_BACK},
        {"Tab", VK_TAB},
        {"Space", VK_SPACE},
        {"ArrowUp", VK_UP}, {"ArrowDown", VK_DOWN}, {"ArrowLeft", VK_LEFT}, {"ArrowRight", VK_RIGHT},
        {"ShiftLeft", VK_LSHIFT}, {"ShiftRight", VK_RSHIFT},
        {"ControlLeft", VK_LCONTROL}, {"ControlRight", VK_RCONTROL},
        {"AltLeft", VK_LMENU}, {"AltRight", VK_RMENU},
        {"MetaLeft", VK_LWIN}, {"MetaRight", VK_RWIN},
        {"Delete", VK_DELETE}, {"Insert", VK_INSERT},
        {"Home", VK_HOME}, {"End", VK_END},
        {"PageUp", VK_PRIOR}, {"PageDown", VK_NEXT},
        {"CapsLock", VK_CAPITAL},
        {"F1", VK_F1}, {"F2", VK_F2}, {"F3", VK_F3}, {"F4", VK_F4},
        {"F5", VK_F5}, {"F6", VK_F6}, {"F7", VK_F7}, {"F8", VK_F8},
        {"F9", VK_F9}, {"F10", VK_F10}, {"F11", VK_F11}, {"F12", VK_F12},
        {"Minus", VK_OEM_MINUS}, {"Equal", VK_OEM_PLUS},
        {"BracketLeft", VK_OEM_4}, {"BracketRight", VK_OEM_6},
        {"Backslash", VK_OEM_5}, {"Semicolon", VK_OEM_1},
        {"Quote", VK_OEM_7}, {"Backquote", VK_OEM_3},
        {"Comma", VK_OEM_COMMA}, {"Period", VK_OEM_PERIOD}, {"Slash", VK_OEM_2}
    };

    auto it = keyMap.find(code);
    if (it != keyMap.end()) {
        return it->second;
    }
    return 0;
}

// Global state tracking
static std::string g_sessionToken = "";
static std::set<WORD> g_heldKeys;
static bool g_leftDown = false;
static bool g_rightDown = false;
static bool g_middleDown = false;

static int g_lastInjectedX = 0;
static int g_lastInjectedY = 0;
// 判定"本地物理移动"的像素容差：高 DPI 缩放下归一化坐标舍入误差可达 10px+
static const int kLocalMoveThresholdPx = 15;
static bool g_hasInjectedOnce = false;
static auto g_lastInjectTime = std::chrono::steady_clock::now();
static auto g_suppressedUntil = std::chrono::steady_clock::now();
static bool g_cursorsHidden = false;
static bool g_wantCursorHidden = false;

static void restoreSystemCursors() {
    // 强制通知 Windows 重新加载系统默认光标主题，恢复被篡改或隐藏的光标
    SystemParametersInfo(SPI_SETCURSORS, 0, NULL, 0);
    g_cursorsHidden = false;
}

static void hideSystemCursors() {
    // 严禁使用 SetSystemCursor 替换全局空白光标！
    // 替换系统光标会导致被控端整台电脑的鼠标指针消失且异常退出时无法自愈。
    // 此处始终主动恢复光标，确保光标可见。
    restoreSystemCursors();
}

static void releaseAll() {
    // Release held mouse buttons
    if (g_leftDown) {
        INPUT input = {0};
        input.type = INPUT_MOUSE;
        input.mi.dwFlags = MOUSEEVENTF_LEFTUP;
        SendInput(1, &input, sizeof(INPUT));
        g_leftDown = false;
    }
    if (g_rightDown) {
        INPUT input = {0};
        input.type = INPUT_MOUSE;
        input.mi.dwFlags = MOUSEEVENTF_RIGHTUP;
        SendInput(1, &input, sizeof(INPUT));
        g_rightDown = false;
    }
    if (g_middleDown) {
        INPUT input = {0};
        input.type = INPUT_MOUSE;
        input.mi.dwFlags = MOUSEEVENTF_MIDDLEUP;
        SendInput(1, &input, sizeof(INPUT));
        g_middleDown = false;
    }

    // Release held keyboard keys
    for (WORD vk : g_heldKeys) {
        INPUT input = {0};
        input.type = INPUT_KEYBOARD;
        input.ki.wVk = vk;
        input.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(1, &input, sizeof(INPUT));
    }
    g_heldKeys.clear();
    restoreSystemCursors();
}

static bool checkLocalOverride() {
    auto now = std::chrono::steady_clock::now();
    if (now < g_suppressedUntil) {
        if (g_wantCursorHidden) restoreSystemCursors();
        return true; // Still within local override suppression window
    }
    if (g_wantCursorHidden && !g_cursorsHidden) hideSystemCursors();

    if (g_hasInjectedOnce) {
        POINT pt;
        if (GetCursorPos(&pt)) {
            // 容差判定：SendInput 的归一化坐标回映射到像素可能有 ±1px 取整误差，
            // 精确不等会把我们自己注入的移动误判为本地操作（导致频繁误触发）。
            int ddx = pt.x - g_lastInjectedX;
            int ddy = pt.y - g_lastInjectedY;
            if (ddx < 0) ddx = -ddx;
            if (ddy < 0) ddy = -ddy;

            if (ddx > kLocalMoveThresholdPx || ddy > kLocalMoveThresholdPx) {
                auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - g_lastInjectTime).count();
                if (elapsedMs > 50) {
                    // 超出自注入容差窗口，判定为本地物理操作：
                    // 同时把基线对齐到当前真实位置，避免用户持续移动时反复重复触发
                    g_lastInjectedX = pt.x;
                    g_lastInjectedY = pt.y;
                    g_suppressedUntil = now + std::chrono::milliseconds(500);
                    if (g_wantCursorHidden) restoreSystemCursors();
                    std::cout << "{\"type\":\"local-override\",\"durationMs\":500}\n" << std::flush;
                    return true;
                }
            }
        }
    }
    return false;
}

static void sendAck(const std::string& op, bool success = true) {
    std::cout << "{\"type\":\"ack\",\"op\":\"" << op << "\",\"success\":" << (success ? "true" : "false") << "}\n" << std::flush;
}

static void sendError(const std::string& message) {
    std::cout << "{\"type\":\"error\",\"message\":\"" << message << "\"}\n" << std::flush;
}

static int runSelfTest() {
    // 1. Verify coordinate translation
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if (vw <= 0 || vh <= 0) {
        std::cerr << "Self-test failed: invalid virtual screen bounds\n";
        return 1;
    }

    double normX = 0.5;
    double normY = 0.5;
    int px = vx + static_cast<int>(normX * vw);
    int py = vy + static_cast<int>(normY * vh);
    if (px < vx || px > vx + vw || py < vy || py > vy + vh) {
        std::cerr << "Self-test failed: coordinate out of virtual screen bounds\n";
        return 1;
    }

    // 2. Verify keycode mapping
    if (mapDomCodeToVk("KeyA") != 'A' || mapDomCodeToVk("Enter") != VK_RETURN || mapDomCodeToVk("Escape") != VK_ESCAPE) {
        std::cerr << "Self-test failed: key code mapping mismatch\n";
        return 1;
    }

    std::cout << "remote-input self-test: PASS\n" << std::flush;
    return 0;
}

int main(int argc, char* argv[]) {
    // Check for self-test argument
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--self-test") {
            return runSelfTest();
        }
    }

    // Ensure clean exit releases all keys on unexpected termination
    std::atexit(releaseAll);
    restoreSystemCursors();

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        std::string type = extractString(line, "type");
        std::string token = extractString(line, "token");

        if (type == "hello") {
            if (token.empty()) {
                sendError("Missing session token in hello");
                continue;
            }
            g_sessionToken = token;
            sendAck("hello", true);
            continue;
        }

        // Validate session token
        if (g_sessionToken.empty() || token != g_sessionToken) {
            sendError("Invalid or unauthorized session token");
            continue;
        }

        if (type == "release-all") {
            releaseAll();
            sendAck("release-all", true);
            continue;
        }

        if (type == "hide-cursor") {
            g_wantCursorHidden = extractBool(line, "hidden", false);
            if (g_wantCursorHidden) hideSystemCursors();
            else restoreSystemCursors();
            sendAck("hide-cursor", true);
            continue;
        }

        if (type == "shutdown") {
            releaseAll();
            sendAck("shutdown", true);
            break;
        }

        // Check local override suppression before injecting
        if (checkLocalOverride()) {
            continue;
        }

        if (type == "pointer-move") {
            double normX = extractDouble(line, "x", 0.0);
            double normY = extractDouble(line, "y", 0.0);

            int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if (vw <= 0) vw = 1920;
            if (vh <= 0) vh = 1080;

            int px = vx + static_cast<int>(normX * vw);
            int py = vy + static_cast<int>(normY * vh);

            INPUT input = {0};
            input.type = INPUT_MOUSE;
            input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
            input.mi.dx = static_cast<LONG>(((px - vx) * 65535) / vw);
            input.mi.dy = static_cast<LONG>(((py - vy) * 65535) / vh);

            SendInput(1, &input, sizeof(INPUT));

            // 回读真实落点作为下一次比对的基线：归一化坐标回映射存在取整误差，
            // 直接用计算出的 px/py 会导致后续误判为本地移动
            POINT actualPt;
            if (GetCursorPos(&actualPt)) {
                g_lastInjectedX = actualPt.x;
                g_lastInjectedY = actualPt.y;
            } else {
                g_lastInjectedX = px;
                g_lastInjectedY = py;
            }
            g_hasInjectedOnce = true;
            g_lastInjectTime = std::chrono::steady_clock::now();
        } else if (type == "pointer-button") {
            std::string button = extractString(line, "button");
            bool pressed = extractBool(line, "pressed", false);

            INPUT input = {0};
            input.type = INPUT_MOUSE;

            if (button == "left") {
                input.mi.dwFlags = pressed ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
                g_leftDown = pressed;
            } else if (button == "right") {
                input.mi.dwFlags = pressed ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
                g_rightDown = pressed;
            } else if (button == "middle") {
                input.mi.dwFlags = pressed ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
                g_middleDown = pressed;
            }

            if (input.mi.dwFlags != 0) {
                SendInput(1, &input, sizeof(INPUT));
                g_lastInjectTime = std::chrono::steady_clock::now();
            }
        } else if (type == "wheel") {
            double deltaX = extractDouble(line, "deltaX", 0.0);
            double deltaY = extractDouble(line, "deltaY", 0.0);

            if (std::abs(deltaY) > 0.001) {
                INPUT input = {0};
                input.type = INPUT_MOUSE;
                input.mi.dwFlags = MOUSEEVENTF_WHEEL;
                input.mi.mouseData = static_cast<DWORD>(static_cast<LONG>(-deltaY));
                SendInput(1, &input, sizeof(INPUT));
            }
            if (std::abs(deltaX) > 0.001) {
                INPUT input = {0};
                input.type = INPUT_MOUSE;
                input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
                input.mi.mouseData = static_cast<DWORD>(static_cast<LONG>(deltaX));
                SendInput(1, &input, sizeof(INPUT));
            }
            g_lastInjectTime = std::chrono::steady_clock::now();
        } else if (type == "key") {
            std::string code = extractString(line, "code");
            bool pressed = extractBool(line, "pressed", false);

            WORD vk = mapDomCodeToVk(code);
            if (vk != 0) {
                INPUT input = {0};
                input.type = INPUT_KEYBOARD;
                input.ki.wVk = vk;
                input.ki.dwFlags = pressed ? 0 : KEYEVENTF_KEYUP;
                SendInput(1, &input, sizeof(INPUT));

                if (pressed) {
                    g_heldKeys.insert(vk);
                } else {
                    g_heldKeys.erase(vk);
                }
                g_lastInjectTime = std::chrono::steady_clock::now();
            }
        }
    }

    releaseAll();
    return 0;
}
