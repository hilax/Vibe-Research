import type { ContentBlock, Sector, Tag } from "./sectors";
import type { CoreNodeDetail } from "./sectorNodeDetails";
import { digitalNodeDetails, digitalSectors } from "./sectorExpansionDigital";
import { industryNodeDetails, industrySectors } from "./sectorExpansionIndustry";
import { techNodeDetails, techSectors } from "./sectorExpansionTech";

interface Group {
  key: string;
  label: string;
  icon: string;
  nodes: string[];
  lead: string;
  boundary: string;
}

interface Plan {
  key: string;
  overview: string;
  groups: [Group, Group, Group];
  stages: [string, string, string];
  risk: string;
  boundary: string;
}

const group = (
  key: string,
  label: string,
  icon: string,
  nodes: string[],
  lead: string,
  boundary: string,
): Group => ({ key, label, icon, nodes, lead, boundary });

// 栏目只整理已核实的产业链结构、工程边界与可观察指标。
// 具体公司、市场规模和阶段进度需要另附可定位到原文的当期证据。
const plans: Plan[] = [
  {
    key: "semiconductor",
    overview: "半导体链条从设计、晶圆制造延伸到封装测试。讨论国产替代须落到具体产品、工艺、客户验证和稳定交付。",
    groups: [
      group("design", "设计与IP", "Cpu", ["EDA与IP", "芯片设计"], "设计工具、可复用模块和芯片架构须与目标制造工艺衔接。", "功能演示、样片流片与量产采用是不同阶段。"),
      group("wafer", "晶圆制造体系", "Factory", ["前道设备", "晶圆材料与工艺化学品", "晶圆制造", "量测与检测"], "设备、材料、工艺和过程量测共同决定晶圆能否稳定制造。", "名义设备产能不能替代合格晶圆产出。"),
      group("backend", "封装与测试", "Boxes", ["封装与测试"], "后道把裸片连接成可用于系统的芯片并筛查电性与可靠性。", "封装样品通过测试不等于终端产品已稳定交付。"),
    ],
    stages: ["明确产品与适用工艺并完成样品验证", "进入客户产线或设计流程并记录验收", "持续取得合格产品和重复交付记录"],
    risk: "设备、材料和设计工具的替代进度应分别核对，不能合并成一个没有口径的国产化率。",
    boundary: "缺少公开客户、工艺范围或合格产出时，保留待验证状态。",
  },
  {
    key: "solid-state-battery",
    overview: "固态电池要把电解质、电极、固固界面和完整电芯放在同一测试条件下理解；材料指标不能直接代表系统性能。",
    groups: [
      group("materials", "电解质与电极", "Dna", ["固态电解质", "复合正极", "负极与锂金属"], "材料路线决定离子与电子通路，也改变电极的制造方法。", "锂金属是部分方案的负极路线，并非所有固态电池都采用。"),
      group("interfaces", "界面与制片", "GitBranch", ["界面工程", "电解质膜与极片制造"], "固固接触与大面积成膜是把材料样品转成电芯的关键环节。", "小面积样品的接触和良率不能直接外推到大尺寸极片。"),
      group("cells", "电芯制造与验证", "ShieldCheck", ["电芯装配与封装", "性能与安全验证"], "装配、压力保持、封装和完整电芯测试应一起核查。", "报告容量或安全表现时必须注明温度、倍率、尺寸和压力等条件。"),
    ],
    stages: ["确认材料配方、界面和实验条件", "完成可复现的大尺寸电芯试制", "核对完整电芯的寿命、安全和批次一致性"],
    risk: "固态体系可能改变风险机理，但不能由“固态”名称推出无短路或无热风险。",
    boundary: "固液混合与全固态、材料样品与完整电芯应分别标注。",
  },
  {
    key: "low-altitude",
    overview: "低空经济同时依赖航空器、空域、起降设施与运营服务。单次试飞不能证明可持续运营。",
    groups: [
      group("aircraft", "航空器与机载系统", "Rocket", ["航空器整机", "动力与能源系统", "飞控与航电"], "整机、动力和飞控须在具体任务工况下联合验证。", "不同构型的载荷、航程和安全冗余不能直接横比。"),
      group("infrastructure", "空域与基础设施", "RadioTower", ["通信导航监视", "起降设施与补能", "空域与飞行服务"], "飞行计划、空地联络、起降和补能共同限制实际可运行区域。", "场地建成不等于已具备持续飞行的全部条件。"),
      group("operations", "审定与运营", "ShieldCheck", ["适航审定与试飞", "场景运营"], "设计审定、运行资质和真实任务服务是不同证据阶段。", "国外认证状态不能直接当作中国商业运营许可。"),
    ],
    stages: ["按机型记录试飞与试验条件", "核对适航、场地和运营资质", "观察批准场景内的持续任务完成记录"],
    risk: "低空任务的安全与经济性取决于具体机型、航线、载荷和运行规则。",
    boundary: "展示飞行、示范航线、收费服务必须分开陈述。",
  },
  {
    key: "smart-driving",
    overview: "智能驾驶要先区分驾驶辅助与自动驾驶，再按运行设计域核对感知、计算、控制和整车验证。",
    groups: [
      group("perception", "感知与计算", "Cpu", ["车载感知", "定位与地图", "车载计算平台"], "车辆需要在明确环境中取得可靠输入并及时处理。", "峰值算力或单项传感器规格不能代替整车安全表现。"),
      group("control", "规划与执行", "GitBranch", ["决策规划与控制软件", "线控执行"], "规划输出须由转向、制动和动力系统在安全边界内执行。", "功能名称不能改变驾驶员或系统在当地规则下的责任。"),
      group("validation", "数据与运行验证", "ShieldCheck", ["数据采集与治理", "仿真测试与安全验证", "整车集成与运行"], "数据闭环、仿真、场地和道路测试应对照具体运行设计域。", "累计里程与演示视频不能单独证明任意道路的安全性。"),
    ],
    stages: ["说明自动化级别、责任与运行设计域", "在相应场景完成系统测试和问题关闭", "跟踪整车版本、可用区域和长期运行事件"],
    risk: "同一硬件会因软件版本、区域规则和驾驶员责任不同而提供不同能力。",
    boundary: "测试资格、量产装车与无限制自动驾驶不能混写。",
  },
  {
    key: "innovative-drug",
    overview: "创新药沿疾病机制、候选物、人体试验、质量生产和注册使用逐级积累证据；人体获益不能由动物数据代替。",
    groups: [
      group("discovery", "发现与临床前", "Dna", ["疾病机制与靶点", "药物发现与临床前"], "靶点假设要经过候选物、药代与毒理研究才能进入人体试验。", "体外或动物有效不能写成人体疗效。"),
      group("clinical", "临床与注册", "Stethoscope", ["临床试验", "CMC与生产", "注册审评"], "人体数据、生产质量和监管审评共同决定药物是否获批及适用范围。", "试验申请、受理和药品批准各是不同节点。"),
      group("access", "服务、合作与可及", "ShieldCheck", ["CXO服务", "国际授权与合作", "商业化与上市后监测"], "研发生产服务与国际许可各有合同边界，获批后仍需持续供应和安全监测。", "许可里程碑、服务合同与药品销售不能合并为已实现收入。"),
    ],
    stages: ["明确靶点与候选物的临床前依据", "核对具体适应症的人体试验设计和结果", "查看当地批准标签、生产质量与上市后记录"],
    risk: "不同疾病、人群和试验设计不可直接用单个疗效数字排名。",
    boundary: "美国 FDA 的流程资料是通用参照；中国产品状态以中国监管记录核实。",
  },
  {
    key: "power-grid",
    overview: "电网与特高压是规划、输变电、配网和调度共同运行的系统。工程规划与已投运能力必须分开。",
    groups: [
      group("network", "规划与输电通道", "Cable", ["规划与网架设计", "特高压换流与变电", "输电线路与电缆"], "电源和负荷的空间位置决定网架与输电通道的工程方案。", "交流变电与直流换流不是同一设备清单。"),
      group("equipment", "设备与保护", "Cog", ["变压器与开关设备", "继电保护与电力通信"], "一次设备承载和切换电能，二次系统负责测量、保护与通信。", "单件验收不等于站级联调已经完成。"),
      group("distribution", "配网与调度", "Network", ["配电网与分布式接入", "调度与源网荷储协同"], "分布式资源接入后，配网承载与调度调用需要同时观察。", "名义可调容量不能替代实际调用记录。"),
    ],
    stages: ["核对规划、核准和接入边界", "核对站线施工、设备交付与联调", "观察投运后的可靠性和实际利用"],
    risk: "电网工程的进度受站线同步、许可、设备交付与调度条件共同约束。",
    boundary: "规划投资、设备订单、通道投运与长期利用各有独立口径。",
  },
  {
    key: "defense",
    overview: "军工只按公开资料描述总体设计、基础件、分系统、总装与保障，不推断未披露装备的性能和采购。",
    groups: [
      group("design", "总体与基础件", "Building2", ["需求与总体设计", "材料与基础元器件"], "总体设计协调接口，基础材料和元器件进入后续系统验证。", "民用技术有相似用途不等于已经进入某装备。"),
      group("subsystems", "机电与信息分系统", "Cpu", ["动力与机电分系统", "电子信息与通信"], "不同平台的机电和电子信息分系统须按各自公开标准理解。", "不据公开技术名称推断未披露通信或探测能力。"),
      group("platform", "总装与保障", "Factory", ["平台制造与总装", "试验验证与保障维护"], "总装、试验、质量管理和维护形成完整工程链。", "公开试验报道不能自动推断批量生产和交付。"),
    ],
    stages: ["核对公开政策、标准与技术范围", "核对公开试验和质量体系资料", "只在明确披露范围内描述生产与维护"],
    risk: "该领域公开信息有限，行业关联不等于具体装备采用。",
    boundary: "未公开的型号、订单、性能和使用状态保持空白。",
  },
  {
    key: "fusion",
    overview: "磁约束聚变装置依靠磁体、真空、加热、控制与热管理等系统协同；实验装置进度不等于商业发电。",
    groups: [
      group("confinement", "约束与加热", "Orbit", ["磁体与超导导体", "真空室与结构", "加热与电流驱动"], "磁场、真空边界和外部能量输入共同构成实验条件。", "单个线圈或加热器测试通过不代表整机持续运行。"),
      group("plasma", "诊断与面对等离子体部件", "ShieldCheck", ["等离子体诊断与控制", "第一壁与偏滤器"], "测量与闭环控制需和耐热、排热部件协同。", "实验持续时间与高热负荷材料寿命应分别记录。"),
      group("fuel", "燃料与辅助系统", "Cog", ["包层与氚燃料循环", "低温与电源系统"], "包层、氚处理、低温及供电关系到装置长期运行方案。", "研究目标、部件试验和已实现的闭式燃料循环不能混写。"),
    ],
    stages: ["按部件记录制造与单机测试", "核对主机和辅助系统联调", "区分等离子体实验、燃料循环与发电验证"],
    risk: "不同装置的技术路线、实验目标和材料条件不应直接合并。",
    boundary: "部件交付与并网发电之间仍有多级独立验证。",
  },
  {
    key: "resources",
    overview: "关键资源从采选、伴生回收延伸到冶炼分离、高纯材料和再生利用；储量不能直接当作可用供给。",
    groups: [
      group("upstream", "采选与伴生回收", "MapPinned", ["资源勘查与采选", "伴生资源回收"], "资源禀赋、主金属加工量与回收工艺共同决定上游产出。", "理论含量和实际回收量不是同一数据。"),
      group("refining", "冶炼与高纯制备", "Factory", ["冶炼与分离", "高纯提炼与材料制备"], "原料经过分离和提纯后才可能满足下游工艺要求。", "矿产量不能直接当成半导体或磁材可用材料量。"),
      group("downstream", "功能材料与再生", "Boxes", ["功能材料加工", "废料回收与再生"], "功能材料加工和二次资源回收共同影响终端可用供给。", "再生材料仍需核对纯度、成本和下游验证。"),
    ],
    stages: ["区分资源量、许可证与实际采选", "核对冶炼分离和高纯产品合格产出", "查看具体终端材料认证与持续供货"],
    risk: "稀土、锗、铟等资源的供给机制与终端用途不同，不能合并成一个统一缺口。",
    boundary: "地质资源、理论产能、实际产量与终端合格材料要分别列示。",
  },
  {
    key: "ai-application",
    overview: "AI 应用从业务任务、合法数据、模型和工具走向系统交付；效果要在真实工作流程中验证。",
    groups: [
      group("inputs", "场景与知识", "Database", ["行业场景与需求", "数据与知识工程"], "明确任务范围、数据来源、更新责任和访问权限。", "上传资料或完成演示不等于可以安全进入生产流程。"),
      group("intelligence", "模型与智能体", "BrainCircuit", ["模型与推理服务", "智能体编排与工具"], "推理服务和工具编排需共同处理时延、权限与失败恢复。", "生成一次回答不等于完成一个可审计的业务任务。"),
      group("delivery", "集成与运营", "Code2", ["业务系统集成", "评测与安全治理", "运营与持续优化"], "系统接入后仍需持续评测、复核和运营质量监测。", "调用量不能替代任务完成质量或用户持续使用。"),
    ],
    stages: ["定义任务与原流程的同口径基线", "核对权限、工具调用和上线验收", "持续记录完成率、接管、返工与成本"],
    risk: "模型版本、资料和业务规则变化可能使一次评测结果失效。",
    boundary: "演示、试点、生产接入和长期使用是不同证据阶段。",
  },
  {
    key: "ai-hardware",
    overview: "端侧 AI 体验由计算、存储、感知、系统软件、供电和整机制造共同决定；不同终端的部件配置不同。",
    groups: [
      group("compute", "计算与连接", "Cpu", ["端侧计算芯片", "存储与无线连接"], "端侧推理受持续性能、内存和连接状态共同约束。", "峰值算力不能代替真实任务的响应、温升和续航。"),
      group("interaction", "感知与显示", "Hand", ["感知与交互器件", "微显示与光学"], "传感器与可选的微显示、光学系统决定设备交互方式。", "无显示眼镜和纯语音终端不使用同一套光学部件。"),
      group("product", "软件与整机", "Factory", ["端侧模型与操作系统", "电池与热管理", "整机制造与检测"], "软件适配、供电、散热和装配测试决定能否持续交付。", "部件送样、整机发布和量产售后需要分别记录。"),
    ],
    stages: ["说明产品形态与端云数据边界", "核对整机任务、续航、安全和认证", "跟踪批量良率、交付与现场故障"],
    risk: "短时演示与长期佩戴使用的性能和安全边界不同。",
    boundary: "不要把某一种眼镜结构当作全部 AI 终端的固定物料清单。",
  },
  {
    key: "energy-storage",
    overview: "电化学储能从电芯、系统集成延伸到并网运行和退役回收；额定容量不等于实际可调用电量。",
    groups: [
      group("battery", "电池与管理", "Database", ["电池材料与电芯", "电池模组与系统集成", "电池管理系统"], "电芯一致性、模组连接和 BMS 保护共同决定系统边界。", "单体电芯寿命不等于整站寿命。"),
      group("power", "变流与调度", "Network", ["储能变流器", "能量管理与调度"], "PCS 和 EMS 把电池能力接到电网调度与计量流程。", "安装容量不等于实际参与充放电或辅助服务。"),
      group("operations", "安全、并网与回收", "ShieldCheck", ["热管理与消防", "并网工程与运营", "退役与回收"], "运行安全、工程验收和退役处置贯穿全寿命周期。", "建设完工不等于并网验收和稳定运营。"),
    ],
    stages: ["核对电芯与系统安全测试", "核对并网工程和系统验收", "记录实际调用、可用率与退役去向"],
    risk: "不同电池技术的寿命、温度与安全边界不能按同一实验条件比较。",
    boundary: "规划容量、投运容量、可用容量和结算电量要分开。",
  },
  {
    key: "data-element",
    overview: "数据要素涉及合法取得、治理、授权、可信流通和实际使用；登记或挂牌数量不能直接代表数据产品价值。",
    groups: [
      group("resources", "资源与授权", "Database", ["数据资源采集与治理", "权利边界与授权"], "数据质量与具体使用授权是后续产品开发的前提。", "登记不等于取得数据的全部权利。"),
      group("trust", "可信流通与安全", "ShieldCheck", ["可信流通基础设施", "隐私保护与安全合规"], "跨主体调用要同时满足互联、身份、权限和安全要求。", "目录上架不等于跨机构数据已经可用。"),
      group("delivery", "产品与应用", "Boxes", ["数据产品开发", "流通交易与交付", "场景应用与效果验证"], "数据产品须有明确质量、交付方式和真实业务使用。", "挂牌交易与持续使用或续约应分别记录。"),
    ],
    stages: ["核对数据来源、质量与授权范围", "核对产品说明、合规交付与访问记录", "观察真实调用、验收和业务效果"],
    risk: "数据跨机构使用涉及国家安全、商业秘密和个人信息等不同约束。",
    boundary: "原始资源规模、交易额和实际应用效果不能互相替代。",
  },
];

const sectorIndex = new Map(
  [...techSectors, ...industrySectors, ...digitalSectors].map((sector): [string, Sector] => [sector.key, sector]),
);
const detailIndex: Record<string, Record<string, CoreNodeDetail>> = {
  ...techNodeDetails,
  ...industryNodeDetails,
  ...digitalNodeDetails,
};

function makeTag(sector: Sector, key: string, label: string, icon: string, description: string, blocks: ContentBlock[]): Tag {
  if (!sector.sources?.length) throw new Error(`缺少 ${sector.key} 的产业链资料来源`);
  return {
    key,
    label,
    icon,
    description,
    verified: true,
    content: [...blocks, { type: "sources", items: sector.sources }],
  };
}

function detailFor(details: Record<string, CoreNodeDetail>, node: string): CoreNodeDetail {
  const detail = details[node];
  if (!detail) throw new Error(`缺少环节解释：${node}`);
  return detail;
}

function buildColumns(plan: Plan): Tag[] {
  const sector = sectorIndex.get(plan.key);
  const details = detailIndex[plan.key];
  if (!sector || !details) throw new Error(`缺少板块配置：${plan.key}`);
  const covered = new Set(plan.groups.flatMap((item) => item.nodes));
  if (covered.size !== sector.nodes.length || sector.nodes.some((node) => !covered.has(node))) {
    throw new Error(`栏目未覆盖全部环节：${plan.key}`);
  }
  const overview = makeTag(sector, "overview", "总览", "LayoutDashboard", `${sector.label}的产业链边界、环节和资料依据。`, [
    { type: "lead", text: plan.overview },
    { type: "heading", text: "产业链环节" },
    { type: "table", headers: ["环节", "它是什么", "为什么关键"], rows: sector.nodes.map((node) => {
      const detail = detailFor(details, node);
      return [node, detail.summary, detail.role];
    }) },
    { type: "callout", tone: "info", text: "下面是依据公开资料整理的环节框架；具体企业产品与项目进展需用当期原文单独核实。" },
  ]);
  const groups = plan.groups.map((item) => makeTag(sector, item.key, item.label, item.icon, item.lead, [
    { type: "lead", text: item.lead },
    { type: "heading", text: "环节分工与验证" },
    { type: "table", headers: ["环节", "作用", "持续跟踪什么"], rows: item.nodes.map((node) => {
      const detail = detailFor(details, node);
      return [node, detail.role, detail.watch];
    }) },
    { type: "callout", tone: "info", text: item.boundary },
  ]));
  const evidence = makeTag(sector, "evidence", "验证路径", "CalendarClock", "把样品、测试和实际使用分阶段核对。", [
    { type: "lead", text: `${sector.label}的进展需要逐级核对，不把单一试验或规划直接写成已交付能力。` },
    { type: "heading", text: "三个可核查阶段" },
    { type: "theses", items: plan.stages.map((body, index) => ({ title: `阶段 ${index + 1}`, body })) },
    { type: "callout", tone: "warn", text: plan.boundary },
  ]);
  const risk = makeTag(sector, "tracking", "风险与跟踪", "ShieldCheck", "按环节记录公开可观察指标与边界。", [
    { type: "lead", text: plan.risk },
    { type: "heading", text: "逐环节跟踪" },
    { type: "table", headers: ["环节", "可观察指标"], rows: sector.nodes.map((node) => [node, detailFor(details, node).watch]) },
    { type: "callout", tone: "warn", text: plan.boundary },
  ]);
  return [overview, ...groups, evidence, risk];
}

export const verifiedSectorColumns: Record<string, Tag[]> = Object.fromEntries(
  plans.map((plan) => [plan.key, buildColumns(plan)]),
);
