cmake_minimum_required(VERSION 3.15)
project(doujiao_dxgi_capturer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(doujiao-dxgi-capturer src/main.cpp)

if(MSVC)
  target_compile_options(doujiao-dxgi-capturer PRIVATE /W4 /utf-8 /EHsc)
endif()

target_link_libraries(doujiao-dxgi-capturer PRIVATE 
    d3d11 
    dxgi 
    user32 
    gdi32 
    ws2_32 
    advapi32
)
