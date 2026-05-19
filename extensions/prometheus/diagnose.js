#!/usr/bin/env node

/**
 * 诊断脚本：直接检查插件内部的 MetricsRegistry
 */

const fs = require('fs');
const path = require('path');

// 读取编译后的代码
const distPath = path.join(__dirname, 'dist', 'index.js');
const code = fs.readFileSync(distPath, 'utf8');

console.log("=== 诊断：MetricsRegistry ===\n");

// 检查 MetricsRegistry 是否导出
if (code.includes('export { MetricsRegistry }') || code.includes('export class MetricsRegistry')) {
  console.log("✅ MetricsRegistry 已导出");
} else {
  console.log("❌ MetricsRegistry 未导出（这是正常的，插件内部使用）");
}

// 检查 observeHistogram 的实现
if (code.includes('observeHistogram(')) {
  console.log("✅ observeHistogram 方法定义存在");

  // 检查是否调用了 inc()
  if (code.includes('this.inc(`')) {
    console.log("✅ observeHistogram 调用了 inc() 方法");

    // 检查是否创建了 _bucket 样本
    if (code.includes('le: String(bound)') || code.includes('le: String(')) {
      console.log("✅ observeHistogram 创建了 _bucket 样本（le 标签）");
    } else {
      console.log("❌ observeHistogram 未创建 _bucket 样本（le 标签）");
    }
  } else {
    console.log("❌ observeHistogram 未调用 inc() 方法");
  }
} else {
  console.log("❌ observeHistogram 方法定义不存在");
}

// 检查 inc() 方法的实现
if (code.includes('inc(name, by, options)')) {
  console.log("\n✅ inc() 方法定义存在");

  // 检查是否调用了 set()
  if (code.includes('this.set(name, current + by, options)')) {
    console.log("✅ inc() 调用了 set() 方法");
  } else {
    console.log("❌ inc() 未调用 set() 方法");
  }
} else {
  console.log("\n❌ inc() 方法定义不存在");
}

// 检查 set() 方法的实现
if (code.includes('set(name, value, options)')) {
  console.log("\n✅ set() 方法定义存在");

  // 检查是否调用了 define()
  if (code.includes('this.define({')) {
    console.log("✅ set() 调用了 define() 方法");

    // 检查是否正确处理了标签
    if (code.includes('Object.keys(options.labels).sort()')) {
      console.log("✅ set() 正确处理了标签（转换为键数组）");
    } else {
      console.log("❌ set() 未正确处理标签");
    }
  } else {
    console.log("❌ set() 未调用 define() 方法");
  }
} else {
  console.log("\n❌ set() 方法定义不存在");
}

// 检查 define() 方法的实现
if (code.includes('define(definition)')) {
  console.log("\n✅ define() 方法定义存在");

  // 检查是否正确处理了 labels 数组
  if (code.includes('...definition.labels ? { labels: [...definition.labels] }')) {
    console.log("✅ define() 正确处理了 labels 数组（展开为副本）");
  } else {
    console.log("❌ define() 未正确处理 labels 数组");
  }
} else {
  console.log("\n❌ define() 方法定义不存在");
}

// 检查 sortedLabels() 方法的实现
if (code.includes('function sortedLabels(')) {
  console.log("\n✅ sortedLabels() 方法定义存在");

  // 检查是否返回了原始对象
  if (code.includes('return labels;')) {
    console.log("✅ sortedLabels() 返回了原始对象");
  } else if (code.includes('return void 0;')) {
    console.log("⚠️ sortedLabels() 返回了 void 0（当 labels 为空时）");
  } else {
    console.log("❌ sortedLabels() 返回值不正确");
  }
} else {
  console.log("\n❌ sortedLabels() 方法定义不存在");
}

// 检查 sampleKey() 方法的实现
if (code.includes('function sampleKey(')) {
  console.log("\n✅ sampleKey() 方法定义存在");

  // 检查是否正确处理了标签（使用 NUL 分隔符）
  if (code.includes('\\0')) {
    console.log("✅ sampleKey() 使用了 NUL 分隔符");
  } else {
    console.log("❌ sampleKey() 未使用 NUL 分隔符");
  }
} else {
  console.log("\n❌ sampleKey() 方法定义不存在");
}

console.log("\n=== 诊断完成 ===");
