#include "analysis.hpp"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <random>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace hydrocalc {
namespace fs = std::filesystem;

static double rounded(double value) {
  return std::round(value * 10000.0) / 10000.0;
}

static void stage(const std::string &name) {
  // 用实际阶段反馈进度，计算进程不访问界面和 SQLite。
  const Json message = {
      {"event", "progress"},
      {"stage", name},
  };
  std::cout << message.dump() << std::endl;
}

static void save_png(const fs::path &path, const cv::Mat &image) {
  // 先编码再通过 filesystem 写入，兼容 Windows 中文和空格路径。
  std::vector<unsigned char> bytes;
  const bool encoded = cv::imencode(".png", image, bytes);
  if (!encoded) {
    throw std::runtime_error("errors.writeFailed");
  }
  std::ofstream stream(path, std::ios::binary);
  stream.write(reinterpret_cast<const char *>(bytes.data()),
               static_cast<std::streamsize>(bytes.size()));
  if (!stream) {
    throw std::runtime_error("errors.writeFailed");
  }
}

static cv::Mat load_image(const fs::path &path) {
  // 文件大小在 Node 入口和这里分别限制，透明图统一合成到白色背景。
  const auto size = fs::file_size(path);
  if (size == 0 || size > 20 * 1024 * 1024) {
    throw std::runtime_error("errors.imageSize");
  }
  std::ifstream stream(path, std::ios::binary);
  std::vector<unsigned char> bytes(size);
  stream.read(reinterpret_cast<char *>(bytes.data()),
              static_cast<std::streamsize>(size));
  cv::Mat source = cv::imdecode(bytes, cv::IMREAD_UNCHANGED);
  if (source.empty()) {
    throw std::runtime_error("errors.invalidImage");
  }
  if (source.total() > 30000000) {
    throw std::runtime_error("errors.pixelLimit");
  }
  if (source.depth() != CV_8U) {
    source.convertTo(source, CV_8U, 1.0 / 256.0);
  }
  cv::Mat image;
  if (source.channels() == 4) {
    image = cv::Mat(source.size(), CV_8UC3);
    for (int y = 0; y < source.rows; ++y) {
      for (int x = 0; x < source.cols; ++x) {
        const auto rgba = source.at<cv::Vec4b>(y, x);
        const double alpha = rgba[3] / 255.0;
        auto &pixel = image.at<cv::Vec3b>(y, x);
        for (int channel = 0; channel < 3; ++channel) {
          pixel[channel] = cv::saturate_cast<unsigned char>(
              rgba[channel] * alpha + 255 * (1 - alpha));
        }
      }
    }
  } else if (source.channels() == 1) {
    cv::cvtColor(source, image, cv::COLOR_GRAY2BGR);
  } else {
    // 彩色 JPEG 使用默认解码应用 EXIF 拍摄方向，避免手机图片横竖颠倒。
    image = cv::imdecode(bytes, cv::IMREAD_COLOR);
  }
  return image;
}

Json metrics(const cv::Mat &mask, const Json &settings) {
  // 使用物理宽高标定每像素的面积和深度，调整分辨率不会改变物理尺度。
  const double width_cm = settings.at("soil_width_cm");
  const double height_cm = settings.at("soil_height_cm");
  const double pixel_area =
      width_cm * height_cm / static_cast<double>(mask.total());
  const double pixel_height = height_cm / mask.rows;
  const int stained = cv::countNonZero(mask);
  std::vector<double> ratios(mask.rows);
  Json profile = Json::array();
  for (int row = 0; row < mask.rows; ++row) {
    const double ratio =
        cv::countNonZero(mask.row(row)) / static_cast<double>(mask.cols);
    ratios[row] = ratio;
    profile.push_back({
        {"depth_cm", rounded((row + 0.5) * pixel_height)},
        {"ratio", rounded(ratio * 100)},
    });
  }

  // 从指定深度寻找基质边界；全部染色延伸到剖面底部，空白图定义为零。
  const double start_cm = settings.at("start_depth_cm");
  const int start_row = std::min(
      mask.rows - 1, static_cast<int>(std::floor(start_cm / pixel_height)));
  const double matrix_threshold = settings.at("matrix_threshold");
  int matrix_row = mask.rows;
  for (int row = start_row; row < mask.rows; ++row) {
    if (ratios[row] <= matrix_threshold) {
      matrix_row = row;
      break;
    }
  }
  int priority_pixels = 0;
  if (matrix_row < mask.rows) {
    priority_pixels = cv::countNonZero(mask.rowRange(matrix_row, mask.rows));
  }

  // 优先流统计边界以下的实际染色像素；最大深度使用有效染色行的下边界。
  double maximum_depth = 0;
  double length_index = 0;
  const double depth_threshold = settings.at("depth_threshold");
  for (int row = 0; row < mask.rows; ++row) {
    if (ratios[row] >= depth_threshold) {
      maximum_depth = (row + 1) * pixel_height;
    }
    if (row > 0) {
      length_index += std::abs(ratios[row] - ratios[row - 1]);
    }
  }
  const double priority_percentage =
      stained == 0 ? 0 : priority_pixels * 100.0 / stained;
  const Json values = {
      {"stained_area_cm2", rounded(stained * pixel_area)},
      {"stained_ratio",
       rounded(stained * 100.0 / static_cast<double>(mask.total()))},
      {"matrix_depth_cm",
       stained == 0 ? 0 : rounded(matrix_row * pixel_height)},
      {"priority_percentage", rounded(priority_percentage)},
      {"priority_area_ratio",
       rounded(priority_pixels * 100.0 / static_cast<double>(mask.total()))},
      {"maximum_depth_cm", rounded(maximum_depth)},
      {"length_index", rounded(length_index * 100)},
  };
  return {
      {"metrics", values},
      {"profile", profile},
  };
}

static Json clustering(const cv::Mat &original, const cv::Mat &mask,
                       const Json &settings, const fs::path &output,
                       bool blurred) {
  // 染色区保留原色、背景设为白色，两种平滑模式分别计算自己的统计。
  cv::Mat image = original.clone();
  cv::Mat background;
  cv::bitwise_not(mask, background);
  image.setTo(cv::Scalar(255, 255, 255), background);
  if (blurred) {
    cv::GaussianBlur(image, image, cv::Size(7, 7), 0);
  }
  cv::Mat hsv;
  cv::cvtColor(image, hsv, cv::COLOR_BGR2HSV);
  const int sample_count = std::min(static_cast<int>(hsv.total()), 20000);
  cv::Mat samples(sample_count, 3, CV_32F);
  std::mt19937 random(42);
  std::uniform_int_distribution<int> distribution(
      0, static_cast<int>(hsv.total()) - 1);
  for (int index = 0; index < sample_count; ++index) {
    const int offset = distribution(random);
    const auto pixel = hsv.at<cv::Vec3b>(offset / hsv.cols, offset % hsv.cols);
    for (int channel = 0; channel < 3; ++channel) {
      samples.at<float>(index, channel) = pixel[channel];
    }
  }
  const int count = settings.at("clusters");
  cv::Mat labels;
  cv::Mat centers;
  cv::setRNGSeed(42);
  const cv::TermCriteria criteria(
      cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 50, 0.2);
  cv::kmeans(samples, count, labels, criteria, 3, cv::KMEANS_PP_CENTERS,
             centers);

  // 全图按最近中心归类，拟合只使用固定上限的样本，降低高分辨率计算开销。
  cv::Mat center_hsv(1, count, CV_8UC3);
  for (int index = 0; index < count; ++index) {
    auto &pixel = center_hsv.at<cv::Vec3b>(0, index);
    for (int channel = 0; channel < 3; ++channel) {
      pixel[channel] =
          cv::saturate_cast<unsigned char>(centers.at<float>(index, channel));
    }
  }
  cv::Mat colors;
  cv::cvtColor(center_hsv, colors, cv::COLOR_HSV2BGR);
  std::vector<int> counts(count, 0);
  for (int row = 0; row < image.rows; ++row) {
    for (int column = 0; column < image.cols; ++column) {
      const auto pixel = hsv.at<cv::Vec3b>(row, column);
      double best_distance = std::numeric_limits<double>::max();
      int best = 0;
      for (int index = 0; index < count; ++index) {
        double distance = 0;
        for (int channel = 0; channel < 3; ++channel) {
          const double difference =
              pixel[channel] - centers.at<float>(index, channel);
          distance += difference * difference;
        }
        if (distance < best_distance) {
          best_distance = distance;
          best = index;
        }
      }
      image.at<cv::Vec3b>(row, column) = colors.at<cv::Vec3b>(0, best);
      ++counts[best];
    }
  }
  save_png(output, image);

  // 跳过无像素的重复中心，界面统计合计保持为 100%。
  Json statistics = Json::array();
  const double total_area = settings.at("soil_width_cm").get<double>() *
                            settings.at("soil_height_cm").get<double>();
  for (int index = 0; index < count; ++index) {
    if (counts[index] == 0) {
      continue;
    }
    const auto color = colors.at<cv::Vec3b>(0, index);
    std::ostringstream hex;
    hex << '#' << std::hex << std::setfill('0') << std::setw(2)
        << static_cast<int>(color[2]) << std::setw(2)
        << static_cast<int>(color[1]) << std::setw(2)
        << static_cast<int>(color[0]);
    const double fraction = counts[index] / static_cast<double>(image.total());
    statistics.push_back({
        {"color", hex.str()},
        {"ratio", rounded(fraction * 100)},
        {"area_cm2", rounded(fraction * total_area)},
    });
  }
  return statistics;
}

Json analyze(const Json &command) {
  // C++ 进程只接收经 Node 验证后的参数快照和应用生成的输入输出路径。
  const auto settings = command.at("settings");
  const fs::path input = fs::u8path(command.at("input").get<std::string>());
  const fs::path directory =
      fs::u8path(command.at("output").get<std::string>());
  stage("reading");
  const cv::Mat source = load_image(input);
  save_png(directory / "original.png", source);
  const int width = settings.at("resolution_width");
  const int height = settings.at("resolution_height");
  if (width < 64 || width > 2000 || height < 64 || height > 2000) {
    throw std::runtime_error("errors.invalidNumbers");
  }
  std::string method = settings.at("method");
  if (method == "auto") {
    // 仅近乎纯黑白且通道一致的输入走二值分析，避免把暗色土壤误判为二值图。
    size_t binary_pixels = 0;
    for (int row = 0; row < source.rows; ++row) {
      for (int column = 0; column < source.cols; ++column) {
        const auto pixel = source.at<cv::Vec3b>(row, column);
        const int minimum = std::min({pixel[0], pixel[1], pixel[2]});
        const int maximum = std::max({pixel[0], pixel[1], pixel[2]});
        if (maximum - minimum <= 2 && (maximum <= 20 || minimum >= 235)) {
          ++binary_pixels;
        }
      }
    }
    method = binary_pixels / static_cast<double>(source.total()) >= 0.98
                 ? "binary"
                 : "hsv";
  }
  cv::Mat resized;
  cv::resize(source, resized, cv::Size(width, height), 0, 0,
             method == "binary" ? cv::INTER_NEAREST : cv::INTER_AREA);
  stage("segmenting");
  cv::Mat mask;
  if (method == "binary") {
    cv::Mat gray;
    cv::cvtColor(resized, gray, cv::COLOR_BGR2GRAY);
    cv::threshold(gray, mask, 127, 255, cv::THRESH_BINARY_INV);
  } else if (method == "hsv") {
    cv::Mat working = resized.clone();
    const int kernel = settings.at("blur_kernel");
    if (kernel > 0) {
      cv::GaussianBlur(working, working, cv::Size(kernel, kernel), 0);
    }
    cv::Mat hsv;
    cv::cvtColor(working, hsv, cv::COLOR_BGR2HSV);
    const std::vector<int> lower = settings.at("lower_hsv");
    const std::vector<int> upper = settings.at("upper_hsv");
    cv::inRange(hsv, cv::Scalar(lower[0], lower[1], lower[2]),
                cv::Scalar(upper[0], upper[1], upper[2]), mask);
  } else {
    throw std::runtime_error("errors.invalidSettings");
  }

  // 指标与纯二值导出都使用同一张掩码；参考线只画在独立副本上。
  stage("measuring");
  Json result = metrics(mask, settings);
  result["effective_method"] = method;
  cv::Mat binary;
  cv::bitwise_not(mask, binary);
  save_png(directory / "mask.png", binary);
  cv::Mat annotated;
  cv::cvtColor(binary, annotated, cv::COLOR_GRAY2BGR);
  const double height_cm = settings.at("soil_height_cm");
  const std::vector<std::pair<double, cv::Scalar>> lines = {
      {result["metrics"]["matrix_depth_cm"], cv::Scalar(104, 117, 184)},
      {settings.at("start_depth_cm"), cv::Scalar(170, 142, 107)},
      {result["metrics"]["maximum_depth_cm"], cv::Scalar(132, 146, 120)},
  };
  for (const auto &line : lines) {
    const int row = std::clamp(
        static_cast<int>(std::round(line.first / height_cm * height)), 0,
        height - 1);
    cv::line(annotated, cv::Point(0, row), cv::Point(width - 1, row),
             line.second, std::max(1, height / 250));
  }
  save_png(directory / "annotated.png", annotated);

  // C++ 逐行写出像素矩阵和深度曲线，避免在 Electron 主线程生成巨型字符串。
  std::ofstream matrix(directory / "matrix.csv", std::ios::binary);
  for (int row = 0; row < height; ++row) {
    for (int column = 0; column < width; ++column) {
      if (column > 0)
        matrix << ',';
      matrix << static_cast<int>(binary.at<unsigned char>(row, column));
    }
    matrix << '\n';
  }
  std::ofstream profile(directory / "profile.csv", std::ios::binary);
  profile << "depth_cm,stained_ratio_percent\n";
  for (const auto &row : result["profile"]) {
    profile << row["depth_cm"].get<double>() << ','
            << row["ratio"].get<double>() << '\n';
  }
  if (!matrix || !profile) {
    throw std::runtime_error("errors.writeFailed");
  }
  result["colors"] = Json::object();
  if (settings.at("enable_clustering").get<bool>()) {
    stage("clustering");
    result["colors"]["clusters"] =
        clustering(resized, mask, settings, directory / "clusters.png", false);
    result["colors"]["clusters_blurred"] = clustering(
        resized, mask, settings, directory / "clusters_blurred.png", true);
  }
  result["source_size"] = {source.cols, source.rows};
  result["engine_version"] = CV_VERSION;
  return result;
}
} // namespace hydrocalc
