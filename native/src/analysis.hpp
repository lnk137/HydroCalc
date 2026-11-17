#pragma once
#include <filesystem>
#include <nlohmann/json.hpp>
#include <opencv2/core.hpp>

namespace hydrocalc {
using Json = nlohmann::json;
Json analyze(const Json &command);
Json metrics(const cv::Mat &mask, const Json &settings);
} // namespace hydrocalc
