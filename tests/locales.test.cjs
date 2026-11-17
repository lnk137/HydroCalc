const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('languages have matching keys and interpolation parameters', () => {
  // 新增语言只维护资源文件，键与参数不一致时阻止构建验收。
  const chinese = require('../locales/zh-CN.json');
  const english = require('../locales/en-US.json');
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(chinese)) {
    assert.ok(english[key].trim(), key);
    const zhParameters = chinese[key].match(/\{\w+\}/g) || [];
    const enParameters = english[key].match(/\{\w+\}/g) || [];
    assert.deepEqual(zhParameters.sort(), enParameters.sort(), key);
  }
});

test('runtime dependencies do not include Python or AI frameworks', () => {
  const configuration = require('../package.json');
  const names = Object.keys(configuration.dependencies);
  assert.ok(!names.some(name => /torch|tensorflow|onnx|python/i.test(name)));
  assert.ok(!fs.existsSync(path.resolve('HC-BackEnd')));
});
