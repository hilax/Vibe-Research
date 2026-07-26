import type { ResearchRecord, SpecialCardDefinition } from "./types";

export const specialCardDefinitions: SpecialCardDefinition[] = [
  {
    recordType: "semiconductor-product",
    sector: "semiconductor",
    title: "半导体国产替代产品卡",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "对象", fields: ["公司", "产品名称", "产品类别", "对应工艺环节", "适用制程或封装节点", "目标客户", "海外对标产品", "国产化前主要供应商"] },
      { title: "验证与量产", fields: ["是否已送样", "是否通过验证", "是否进入产线", "是否用于量产", "客户数量", "订单情况", "出货数量", "收入情况"] },
      { title: "制造与经济性", fields: ["毛利率", "产能", "良率", "客户切换成本", "验证周期"] },
      { title: "技术与卡口", fields: ["核心技术指标", "当前主要短板", "是否属于全球技术卡口", "是否仅属于国产替代机会"] },
      { title: "证据", fields: ["数据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "设备可以用于某工艺 ≠ 设备已经进入客户产线",
      "材料通过实验室测试 ≠ 材料已经用于批量生产",
      "国产替代空间大 ≠ 公司已经获得可验证收入",
    ],
  },
  {
    recordType: "solid-state-product",
    sector: "solid-state-battery",
    title: "固态电池技术与产品卡",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "对象与路线", fields: ["公司", "电池或材料名称", "技术路线", "电解质类型", "正极体系", "负极体系", "是否使用锂金属", "全固态/半固态/凝聚态"] },
      { title: "性能条件", fields: ["能量密度", "循环寿命", "快充能力", "安全测试", "工作温度", "压力要求", "电芯规格"] },
      { title: "产业化阶段", fields: ["样品阶段", "中试阶段", "装车阶段", "车型定点", "SOP时间"] },
      { title: "制造与成本", fields: ["规划产能", "实际有效产能", "良率", "单位成本", "关键设备", "关键材料", "当前最大量产卡口"] },
      { title: "证据", fields: ["数据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "实验室单体数据 ≠ 大容量电芯数据",
      "大容量电芯数据 ≠ 电池包装车数据 ≠ 批量量产数据",
      "半固态、凝聚态和全固态不得混为一谈",
    ],
  },
  {
    recordType: "low-altitude-project",
    sector: "low-altitude",
    title: "低空飞行器与运营项目卡",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "飞行器", fields: ["公司", "飞行器型号", "飞行器类型", "应用场景", "载人数", "最大起飞重量", "有效载荷", "航程", "续航时间", "巡航速度"] },
      { title: "系统", fields: ["动力路线", "电池类型", "电机数量", "飞控架构", "通信和导航方式"] },
      { title: "适航与许可", fields: ["原型机状态", "首飞状态", "型号合格证状态", "生产许可证状态", "适航证状态", "运营许可"] },
      { title: "订单与交付", fields: ["订单数量", "意向订单数量", "已交付数量", "付费运营数量"] },
      { title: "运营", fields: ["单机价格", "运营模式", "单次收费", "使用频率", "事故或故障记录"] },
      { title: "证据", fields: ["数据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "意向订单 ≠ 锁定订单 ≠ 预付款订单",
      "已生产 ≠ 已交付 ≠ 已获得适航",
      "获得适航 ≠ 已开展付费运营",
    ],
  },
  {
    recordType: "smart-driving-nomination",
    sector: "smart-driving",
    title: "智能驾驶系统与车型定点卡",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "系统", fields: ["公司", "产品或系统名称", "智驾等级", "应用场景", "高速NOA", "城市NOA", "泊车"] },
      { title: "硬件", fields: ["芯片平台", "算力", "传感器配置", "摄像头数量", "毫米波雷达数量", "激光雷达数量", "域控制器"] },
      { title: "软件与数据", fields: ["软件算法", "是否采用端到端", "是否采用世界模型", "数据闭环方式"] },
      { title: "定点与搭载", fields: ["主要车企客户", "定点车型", "定点时间", "SOP时间", "搭载车型", "实际搭载量"] },
      { title: "用户与财务", fields: ["渗透率", "激活率", "付费率", "单车价值", "软件收费模式", "收入", "毛利率"] },
      { title: "证据", fields: ["数据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "技术合作 ≠ 项目定点 ≠ 车型SOP",
      "车型SOP ≠ 实际搭载 ≠ 用户激活",
      "用户激活 ≠ 用户付费 ≠ 软件收入确认",
    ],
  },
  {
    recordType: "innovative-drug-asset",
    sector: "innovative-drug",
    title: "创新药资产卡（复用生物医药主数据）",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "资产", fields: ["公司", "药物名称", "药物类型", "靶点", "作用机制", "适应症", "单药或联合"] },
      { title: "研发", fields: ["中国研发阶段", "海外研发阶段", "临床试验编号", "试验设计", "入组人数", "患者人群", "治疗线数", "生物标志物"] },
      { title: "临床数据", fields: ["对照组", "主要终点", "次要终点", "疗效数据", "安全性数据", "数据成熟度", "随访时间"] },
      { title: "监管与商业", fields: ["监管资格", "申报状态", "获批状态", "商业化状态", "销售收入", "医保情况"] },
      { title: "BD与权益", fields: ["BD合作", "首付款", "近期里程碑", "远期里程碑", "销售分成", "权益归属", "下一项催化剂"] },
      { title: "证据", fields: ["数据来源", "更新时间", "可信度", "确定性等级"] },
    ],
    stageBoundary: [
      "同靶点或同平台成功 ≠ 本资产临床成功",
      "不同试验、人群、剂量、治疗线数和随访时间不得直接横向比较",
      "交易总上限 ≠ 已确认收入；获批 ≠ 医保准入或商业成功",
    ],
  },
  {
    recordType: "power-grid-order",
    sector: "power-grid",
    title: "电网项目与设备订单卡",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "项目", fields: ["项目名称", "项目类型", "项目业主", "项目地区", "输电类型", "电压等级", "输送容量", "线路长度", "总投资"] },
      { title: "里程碑", fields: ["核准日期", "开工日期", "招标日期", "中标日期", "预计投运日期", "实际投运日期"] },
      { title: "设备与订单", fields: ["设备类别", "中标公司", "中标金额", "订单执行周期", "已交付比例"] },
      { title: "兑现", fields: ["收入确认情况", "毛利率", "原材料价格影响", "产能利用率"] },
      { title: "证据", fields: ["数据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "电网规划 ≠ 项目核准 ≠ 项目招标",
      "项目招标 ≠ 公司中标 ≠ 设备交付",
      "设备交付 ≠ 工程投运 ≠ 收入确认",
    ],
  },
  {
    recordType: "defense-product-order",
    sector: "defense",
    title: "军工产品与订单卡",
    emptyValue: "公开信息不足",
    fieldGroups: [
      { title: "产品", fields: ["公司", "产品名称", "装备类别", "所属军种或应用方向"] },
      { title: "研制与列装", fields: ["研制阶段", "是否完成鉴定", "是否完成设计定型", "是否进入小批量", "是否进入批量列装"] },
      { title: "客户与订单", fields: ["主要客户", "订单信息", "合同负债", "存货", "预付款"] },
      { title: "生产与交付", fields: ["产能", "交付节奏", "军品收入", "军品收入占比"] },
      { title: "财务与风险", fields: ["毛利率", "应收账款", "回款周期", "价格调整", "降价风险", "保密信息缺失说明"] },
      { title: "证据", fields: ["证据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "预研/原型 ≠ 鉴定 ≠ 设计定型",
      "小批量 ≠ 批量列装 ≠ 可公开核验的持续订单",
      "无法公开核实的信息必须标记“公开信息不足”，不得以传闻补全",
    ],
  },
  {
    recordType: "fusion-project-equipment",
    sector: "fusion",
    title: "可控核聚变项目与设备卡",
    emptyValue: "暂无可靠公开数据",
    fieldGroups: [
      { title: "项目", fields: ["项目名称", "国家或地区", "项目主体", "技术路线", "装置类型"] },
      { title: "物理目标", fields: ["等离子体参数", "磁场强度", "超导材料", "约束时间", "聚变增益目标", "脉冲或稳态"] },
      { title: "工程里程碑", fields: ["建设阶段", "土建状态", "设备招标状态", "设备安装状态", "首次等离子体时间", "氘氚实验计划", "发电验证计划"] },
      { title: "资金与供应", fields: ["项目预算", "已投入资金", "核心供应商", "订单金额", "已交付设备", "收入确认情况"] },
      { title: "证据", fields: ["当前技术卡口", "数据来源", "更新时间", "确定性等级"] },
    ],
    stageBoundary: [
      "理论设计 ≠ 实验室结果 ≠ 子系统验证 ≠ 工程装置建设",
      "首次等离子体 ≠ 氘氚燃烧 ≠ 能量增益验证 ≠ 连续稳定运行",
      "连续稳定运行 ≠ 示范发电 ≠ 商业发电",
    ],
  },
];

export const specialCardDefinitionByType = new Map<ResearchRecord["recordType"], SpecialCardDefinition>(
  specialCardDefinitions.map((definition) => [definition.recordType, definition]),
);
