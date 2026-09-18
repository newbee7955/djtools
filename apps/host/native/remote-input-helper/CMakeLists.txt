cmake_minimum_required(VERSION 3.15)
project(doujiao_remote_input LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(doujiao-remote-input src/main.cpp)

if(MSVC)
  target_compile_options(doujiao-remote-input PRIVATE /W4 /utf-8)
endif()

target_link_libraries(doujiao-remote-input PRIVATE user32)
