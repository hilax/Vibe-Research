import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importStandaloneTypeScript(relativePath) {
  const moduleUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(moduleUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: moduleUrl.pathname,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
  );
}

const { expandedSectorSpecs } = await importStandaloneTypeScript(
  "../../src/data/expandedSectors/configs.ts",
);
const { specialCardDefinitions } = await importStandaloneTypeScript(
  "../../src/data/research/specialCards.ts",
);
const { extendedResearchSources } = await importStandaloneTypeScript(
  "../../src/data/research/extendedSources.ts",
);

const expectedTags = {
  semiconductor: ["总览", "外部限制与国产化逻辑", "芯片设计与产品", "晶圆制造与工艺", "半导体设备", "半导体材料与零部件", "先进封装与测试", "公司格局与国产化进度", "确定性地图"],
  "solid-state-battery": ["总览", "技术路线", "电解质与关键材料", "正极、负极与界面", "电芯结构与制造工艺", "设备、良率与量产卡口", "车企和电池厂验证", "产业链与公司", "确定性地图"],
  "low-altitude": ["总览", "飞行器整机", "动力、电池与能源系统", "航电、飞控、通信与感知", "低空基础设施", "空域、适航与监管", "运营场景与商业模式", "产业链与公司", "确定性地图"],
  "smart-driving": ["总览", "驾驶分级与系统架构", "传感器与感知系统", "智驾芯片与域控制器", "算法、数据闭环与软件", "线控底盘与执行系统", "车型定点、搭载与渗透", "产业链与公司", "确定性地图"],
  "innovative-drug": ["总览", "靶点与作用机制", "药物类型与技术平台", "疾病赛道", "临床与管线", "监管、注册与支付", "BD交易与商业化", "公司格局与估值", "确定性地图"],
  "power-grid": ["总览", "电网投资与规划", "特高压直流", "特高压交流", "主网一次设备", "二次设备、配网与数字电网", "新能源消纳、储能与柔性输电", "公司订单、业绩与出海", "确定性地图"],
  defense: ["总览", "航空装备", "航天、导弹与防空", "船舶与海洋装备", "地面装备", "军工电子与信息化", "无人化与智能化装备", "材料、元器件与军工铲子", "订单、产能与公司格局", "确定性地图"],
  fusion: ["总览", "技术路线", "全球装置与重点项目", "超导磁体与磁约束系统", "真空、加热、诊断与控制", "第一壁、偏滤器与关键材料", "燃料、氚循环与发电系统", "产业链与公司", "确定性地图"],
};

test("all eight sector specs expose the exact requested Tag labels", () => {
  assert.equal(expandedSectorSpecs.length, 8);
  assert.equal(new Set(expandedSectorSpecs.map((sector) => sector.key)).size, 8);
  for (const sector of expandedSectorSpecs) {
    assert.deepEqual(
      sector.tags.map((tag) => tag.label),
      expectedTags[sector.key],
    );
    assert.equal(new Set(sector.tags.map((tag) => tag.key)).size, sector.tags.length);
    assert.ok(sector.tags.every((tag) => tag.focus && tag.metrics && tag.boundary));
  }
});

test("every expanded sector has a matching dedicated card schema", () => {
  assert.equal(specialCardDefinitions.length, 8);
  assert.equal(new Set(specialCardDefinitions.map((item) => item.sector)).size, 8);
  assert.equal(new Set(specialCardDefinitions.map((item) => item.recordType)).size, 8);
  for (const definition of specialCardDefinitions) {
    assert.ok(definition.fieldGroups.length >= 4);
    assert.ok(definition.fieldGroups.every((group) => group.fields.length > 0));
    assert.ok(definition.stageBoundary.length >= 3);
  }
});

test("source registry is unique and covers every sector source reference", () => {
  const sourceIds = new Set(extendedResearchSources.map((source) => source.id));
  assert.equal(sourceIds.size, extendedResearchSources.length);
  for (const sector of expandedSectorSpecs) {
    for (const sourceId of sector.sourceIds) {
      assert.ok(sourceIds.has(sourceId), `${sector.key} references missing source ${sourceId}`);
    }
  }
  for (const source of extendedResearchSources) {
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.lastVerifiedAt);
    assert.ok(source.summary);
    assert.ok(["A", "B", "C", "D", "E"].includes(source.grade));
  }
});
