cmake_minimum_required(VERSION 3.24)
project(HydroCalcWorker VERSION 2.0.0 LANGUAGES C CXX)

# 固定第三方版本，构建独立静态计算程序，不依赖用户安装 OpenCV 或 Python。
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "Third-party compatibility")
include(FetchContent)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
FetchContent_Declare(json
  URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
)
FetchContent_MakeAvailable(json)

# 仅编译图像计算与 PNG/JPEG 编解码，关闭 GUI、视频、训练和 Python 模块。
set(BUILD_LIST core,imgproc,imgcodecs CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_WITH_STATIC_CRT ON CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_PERF_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_apps OFF CACHE BOOL "" FORCE)
set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
set(BUILD_JPEG ON CACHE BOOL "" FORCE)
set(BUILD_PNG ON CACHE BOOL "" FORCE)
set(BUILD_ZLIB ON CACHE BOOL "" FORCE)
set(WITH_OPENCL OFF CACHE BOOL "" FORCE)
set(WITH_IPP OFF CACHE BOOL "" FORCE)
set(WITH_ITT OFF CACHE BOOL "" FORCE)
set(WITH_LAPACK OFF CACHE BOOL "" FORCE)
set(WITH_FFMPEG OFF CACHE BOOL "" FORCE)
set(WITH_GSTREAMER OFF CACHE BOOL "" FORCE)
set(WITH_OPENEXR OFF CACHE BOOL "" FORCE)
set(WITH_TIFF OFF CACHE BOOL "" FORCE)
set(WITH_WEBP OFF CACHE BOOL "" FORCE)
set(WITH_AVIF OFF CACHE BOOL "" FORCE)
set(WITH_JASPER OFF CACHE BOOL "" FORCE)
set(WITH_PROTOBUF OFF CACHE BOOL "" FORCE)
set(OPENCV_GENERATE_PKGCONFIG OFF CACHE BOOL "" FORCE)
FetchContent_Declare(opencv
  URL https://github.com/opencv/opencv/archive/refs/tags/4.12.0.tar.gz
  URL_HASH SHA256=44c106d5bb47efec04e531fd93008b3fcd1d27138985c5baf4eafac0e1ec9e9d
)
FetchContent_MakeAvailable(opencv)

add_executable(hydrocalc-worker src/main.cpp src/analysis.cpp)
set_target_properties(hydrocalc-worker PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/worker-bin")
target_include_directories(hydrocalc-worker PRIVATE
  ${opencv_SOURCE_DIR}/modules/core/include
  ${opencv_SOURCE_DIR}/modules/imgproc/include
  ${opencv_SOURCE_DIR}/modules/imgcodecs/include
  ${opencv_BINARY_DIR}
  ${CMAKE_BINARY_DIR}
)
target_link_libraries(hydrocalc-worker PRIVATE opencv_core opencv_imgproc opencv_imgcodecs nlohmann_json::nlohmann_json)
if(MSVC)
  target_compile_options(hydrocalc-worker PRIVATE /utf-8)
endif()
if(WIN32)
  target_compile_definitions(hydrocalc-worker PRIVATE NOMINMAX)
endif()
install(TARGETS hydrocalc-worker RUNTIME DESTINATION .)
