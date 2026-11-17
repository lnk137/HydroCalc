#include "analysis.hpp"
#include <iostream>
#include <string>

int main() {
  // 每次进程只接收一项 JSON 任务，标准输出仅用于逐行 JSON 消息。
  cv::setNumThreads(1);
  std::string line;
  if (!std::getline(std::cin, line)) {
    return 1;
  }
  try {
    const auto command = hydrocalc::Json::parse(line);
    const auto result = hydrocalc::analyze(command);
    const hydrocalc::Json message = {
        {"event", "result"},
        {"data", result},
    };
    std::cout << message.dump() << std::endl;
    return 0;
  } catch (const std::exception &error) {
    // 计算异常成为明确失败消息，由 Node 保存到对应记录，禁止混用旧结果。
    const hydrocalc::Json message = {
        {"event", "error"},
        {"message", error.what()},
    };
    std::cout << message.dump() << std::endl;
    return 1;
  }
}
