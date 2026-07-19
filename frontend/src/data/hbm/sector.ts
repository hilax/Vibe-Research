import { sourceItems } from "@/data/research";
import type { ContentBlock, Sector } from "@/data/sectors";

const sources = (ids: string[]): ContentBlock => ({ type: "sources", items: sourceItems(ids) });

const overview: ContentBlock[] = [
  { type: "heading", text: "1. 一句话定性" },
  { type: "lead", text: "HBM（High Bandwidth Memory，高带宽内存）通过多层DRAM堆叠和超宽接口，为高性能计算提供高带宽、较低每比特功耗和高封装密度。AI芯片研究不能只看计算核心，还要同时看HBM容量、带宽、堆叠层数、封装、散热、良率和真实供应能力。" },
  { type: "heading", text: "2. HBM和普通DRAM的区别" },
  { type: "table", headers: ["维度", "HBM", "普通DDR/服务器DRAM", "研究含义"], rows: [
    ["封装形态", "多层DRAM垂直堆叠，靠TSV连接，并与计算芯片近距离先进封装", "DIMM或板级颗粒，离计算芯片更远", "HBM要把存储和先进封装作为一个系统"],
    ["接口宽度", "HBM3E通常1,024-bit；HBM4增至2,048-bit", "每通道窄得多，通过频率/通道扩展", "带宽提升不仅靠单Pin速率"],
    ["带宽/功耗", "高总带宽、较低每比特I/O功耗", "容量扩展灵活、生态成熟", "看总系统能效而非只看颗粒功耗"],
    ["制造难度", "TSV、薄化、堆叠/键合、Base Die和良率累乘", "主要是DRAM晶圆与模组制造", "晶圆投入不能直接等同良品出货"],
    ["测试", "需要Known Good Die、堆叠和封装级测试", "颗粒/模组测试成熟", "测试覆盖、并行度和故障定位影响成本"],
    ["成本/场景", "单位容量成本高，主要用于GPU/ASIC/HPC", "通用服务器、PC和容量扩展", "不能用普通DRAM价格周期直接替代HBM定价"],
  ] },
  { type: "heading", text: "3. HBM产业链地图" },
  { type: "supply-chain", title: "从DRAM晶圆到AI系统", items: [
    { eyebrow: "前道", title: "DRAM晶圆＋TSV", text: "DRAM工艺、深硅刻蚀、绝缘/阻挡/种子层、电镀填充。" },
    { eyebrow: "薄化", title: "减薄＋切割＋KGD", text: "临时键合支撑薄晶圆，测试筛出Known Good Die。" },
    { eyebrow: "堆叠", title: "键合＋Base Die", text: "多层对准、微凸点/MUF或混合键合路线，Base Die承担接口/逻辑。", highlight: true },
    { eyebrow: "系统", title: "2.5D封装＋GPU/ASIC", text: "HBM与计算芯片通过中介层/桥接共同封装，再进入加速卡与服务器。" },
  ], conclusion: "HBM堆叠产能、GPU晶圆、Base Die、先进封装中介层和最终封装测试都可能成为独立瓶颈；扩其中一项不等于最终AI芯片交付增加。" },
  { type: "heading", text: "4. 价值来源" },
  { type: "theses", items: [
    { title: "搭载容量提升", body: "更大模型、长上下文和KV Cache提高单加速器容量需求，但要看平台具体堆栈数量和容量。" },
    { title: "代际升级", body: "I/O位宽、Pin速率、层数和Base Die升级提高价值，也提高工艺和测试难度。" },
    { title: "供应/良率壁垒", body: "客户认证、薄Die、键合、散热和整体良率使名义晶圆产能与良品产出存在距离。" },
  ] },
  { type: "paragraph", text: "第四条价值来源是单颗价值量：容量、层数、逻辑Base Die和封装复杂度可能提升，但ASP必须以公司披露或可靠合同/多源数据为准，不能自行按晶圆面积估算。" },
  { type: "heading", text: "5. 主要风险" },
  { type: "list", items: ["客户功能、可靠性或系统认证失败", "量产延期或良率不及预期", "薄Die、堆叠、散热或Base Die问题", "先进封装/中介层/基板产能限制", "下游GPU/ASIC延期导致库存错配", "扩产过快、长约变化和价格下降", "混合键合等技术路线切换带来设备材料迁移"] },
  { type: "research-assets", title: "HBM产品卡工作台", sector: "hbm", recordType: "hbm-product" },
  sources(["samsung-hbm4-2026", "samsung-hbm4-amd-2026", "samsung-hbm4e-2026", "skhynix-hbm3e-12h", "micron-2025-10k"]),
];

const generations: ContentBlock[] = [
  { type: "heading", text: "代际总表：标准、厂商产品和商业阶段分开" },
  { type: "table", headers: ["标准/产品代际", "典型堆叠/容量", "I/O位宽", "单Pin速率/带宽", "Base Die/键合变化", "主要应用", "商业阶段边界"], rows: [
    ["HBM（首代）", "早期4层产品，容量因厂商而异", "1,024-bit", "按具体厂商数据表", "TSV堆叠+早期Base Die", "GPU/HPC早期产品", "历史量产；不与当前AI平台混用"],
    ["HBM2", "4/8层等，容量因产品", "1,024-bit", "按标准/产品", "堆叠和封装能力提升", "GPU/HPC", "历史成熟代际"],
    ["HBM2E", "常见8层，容量因产品", "1,024-bit", "较HBM2提速", "热/堆叠继续优化", "HPC/AI加速器", "已量产但新平台逐步换代"],
    ["HBM3", "8/12层；代表产品24GB", "1,024-bit", "按厂商产品", "12层薄Die/先进MUF等", "Hopper等AI平台", "已量产"],
    ["HBM3E", "8层24GB、12层36GB等", "1,024-bit", "代表产品最高9.6Gbps、约1.2TB/s", "更薄Die、热与良率要求提升", "Blackwell/MI300系等", "主力量产；不同客户/供应商阶段仍不同"],
    ["HBM4", "12层24—36GB；16层48GB为部分厂商路线", "2,048-bit", "Samsung量产产品11.7Gbps持续、最高3.3TB/s公司口径", "逻辑Base Die功能/工艺升级；客户定制增强", "Vera Rubin/MI455X等下一代平台", "截至日不同厂商处于量产、客户认证或准备阶段，不能统一写"],
    ["HBM4E", "Samsung样品12层48GB；其他厂商按路线图", "2,048-bit代际", "Samsung样品14—16Gbps、最高3.6TB/s公司口径", "延续逻辑Base Die并提高热/能效", "后续AI平台", "2026-05 Samsung为送样阶段；不能写成认证/量产"],
  ], note: "电压、容量和键合方式若没有同一标准/产品官方数据则留空；厂商超规格目标不能替代JEDEC标准或量产规格。" },
  { type: "heading", text: "七个阶段检查" },
  { type: "supply-chain", title: "不要把路线图写成出货", items: [
    { eyebrow: "规则", title: "标准发布", text: "定义互操作和规格边界，不证明任何厂商量产。" },
    { eyebrow: "研发", title: "开发完成→送样", text: "样品进入客户，仍需功能、可靠性和系统验证。" },
    { eyebrow: "认证", title: "认证→小批量", text: "通过特定客户/平台，不自动扩展到所有客户。", highlight: true },
    { eyebrow: "商业", title: "量产→终端系统", text: "还要看实际良品产出、先进封装配套和GPU/ASIC系统出货。" },
  ], conclusion: "任何“供货”表述必须标注送样、验证、小批量还是批量；同一厂商不同客户可能处于不同阶段。" },
  { type: "research-assets", title: "按阶段筛选HBM产品", sector: "hbm", recordType: "hbm-product" },
  sources(["samsung-hbm4-2026", "samsung-hbm4e-2026", "skhynix-hbm3e-12h", "skhynix-hbm4-2025", "micron-2025-10k"]),
];

const manufacturing: ContentBlock[] = [
  { type: "heading", text: "1. 制造流程" },
  { type: "kv", items: [
    { term: "① DRAM制造", value: "完成存储阵列、外围电路和TSV相关前道工艺；节点影响功耗、密度和良率。" },
    { term: "② TSV形成", value: "深硅刻蚀 → 绝缘/阻挡/种子层 → 铜电镀填充 → 平坦化。" },
    { term: "③ 临时键合与减薄", value: "将晶圆固定到载体后减薄，控制裂片、应力和翘曲，再解键合。" },
    { term: "④ 切割与KGD", value: "分离Die并通过探针/测试筛出Known Good Die，减少高价值堆叠后的报废。" },
    { term: "⑤ 多层堆叠与键合", value: "逐层高精度对准，采用微凸点+TCB/MUF或向混合键合演进。" },
    { term: "⑥ Base Die集成", value: "Base Die连接DRAM堆栈和计算芯片；HBM4增强逻辑与定制空间。" },
    { term: "⑦ 封装/测试", value: "完成堆栈级测试，再与GPU/ASIC、中介层、基板共同封装并做系统级验证。" },
  ] },
  { type: "heading", text: "2. 核心难点" },
  { type: "table", headers: ["难点", "失效机制", "产能/良率影响", "验证指标"], rows: [
    ["TSV一致性", "空洞、残留、阻值/应力异常", "坏Die或长期可靠性", "孔形貌、填充、链路电阻、可靠性"],
    ["薄晶圆翘曲", "减薄应力、搬运裂片", "节拍下降/报废", "厚度均匀性、翘曲、破片率"],
    ["多层对准", "错位、微凸点开路/短路", "层数越高累乘", "对准精度、连接良率"],
    ["键合/底填", "空洞、界面剥离、热机械失配", "热与可靠性不稳定", "空洞率、剪切、温循"],
    ["散热/功耗", "顶部Die热路径长、I/O功耗", "降频或寿命问题", "热阻、结温、能效"],
    ["测试覆盖", "堆叠后难定位坏层/坏TSV", "高价值封装报废", "KGD覆盖、堆叠/系统测试"],
    ["量产稳定性", "设备漂移、材料批次与工艺窗口", "名义产能无法转良品", "OEE、良率爬坡、返工和实际产出"],
  ] },
  { type: "heading", text: "3. Base Die变化" },
  { type: "paragraph", text: "Base Die从连接和控制底座逐步增加更复杂I/O、功耗管理、修复和定制逻辑。HBM4接口翻倍到2,048-bit并强化客户定制，使存储厂、逻辑代工厂、计算芯片客户和封装厂的协同更深；Samsung采用自家4nm逻辑Base Die是一个已公开案例，但不能外推所有厂商分工。" },
  { type: "table", headers: ["分工方", "可能职责", "商业影响", "关键风险"], rows: [
    ["存储厂", "DRAM、堆叠、产品验证", "HBM价值与客户绑定加深", "良率、客户集中"],
    ["逻辑代工", "先进Base Die制造", "新增逻辑晶圆与先进节点需求", "工艺/产能协同"],
    ["计算芯片客户", "定义接口、功耗与定制逻辑", "更早锁定供应链", "产品延期传导"],
    ["OSAT/先进封装", "中介层/基板/最终封装测试", "高复杂度封装价值", "产能、翘曲、整体良率"],
    ["设计服务/EDA", "Base Die/封装协同和签核", "定制化机会", "IP、接口和客户认证"],
  ] },
  { type: "heading", text: "4. 四种产能不得相加混用" },
  { type: "table", headers: ["产能", "单位", "能证明什么", "不能证明什么"], rows: [
    ["HBM堆叠产能", "堆栈/月或等价口径", "TSV后堆叠与测试能力", "GPU晶圆和最终封装是否齐备"],
    ["GPU/ASIC晶圆", "wafer starts/month", "计算Die投入", "良品Die和系统出货"],
    ["中介层/2.5D", "封装片/月", "共同封装能力", "HBM/基板/测试不短缺"],
    ["最终系统封装", "模组/系统/月", "可交付模组节拍", "客户上电/验收和收入"],
  ] },
  sources(["samsung-hbm4-2026", "skhynix-hbm3e-12h", "skhynix-hbm4-2025", "naura-2025-ar"]),
];

const equipment: ContentBlock[] = [
  { type: "heading", text: "设备和材料总表" },
  { type: "table", headers: ["环节", "作用", "技术壁垒/全球供应", "中国供应/验证", "HBM卡口属性", "代际用量/收入证据"], rows: [
    ["深硅刻蚀", "形成高深宽比TSV", "孔形貌、选择比、均匀性；Lam/TEL/Applied等", "北方华创称设备适配HBM并进入国内头部存储厂批采；全球HBM客户待核", "HBM必需，设备集中度较高", "层数/产能提升增加步骤；HBM收入未单拆"],
    ["薄膜沉积/ALD/CVD/PVD", "绝缘、阻挡、种子层", "高深宽比覆盖和低缺陷", "北方华创等国内量产线进展按年报", "TSV必需但设备可按工艺替代", "随TSV产能增长；产品级收入待补"],
    ["铜电镀", "填充TSV/互联", "无空洞填充、化学和均匀性", "北方华创等设备；电镀液厂商需客户验证", "工艺与材料共同卡口", "随TSV数量/产能"],
    ["清洗/CMP", "去残留和平坦化", "低损伤、缺陷与端点控制", "国内已有多类设备，但HBM客户逐项核", "必要工序，不必然全球唯一卡口", "随wafer投入"],
    ["临时键合/解键合", "支撑超薄晶圆搬运", "低应力、洁净、兼容后续温度；EVG/SUSS等", "国产设备/材料多在验证，需量产客户证据", "薄化和高层堆叠关键", "层数/薄化难度提升受益"],
    ["晶圆减薄", "把DRAM Die做薄", "厚度均匀、低损伤、低翘曲；DISCO等", "国产减薄设备已用于先进封装；是否HBM批量待核", "12/16层关键", "更高层数提高工艺难度"],
    ["晶圆切割", "分离DRAM/Base Die", "崩边、颗粒、薄片搬运；DISCO/ADT等", "光力科技先进封装批量销售，但HBM产线待验证", "必需但不一定全球卡口", "随Die数量；HBM收入未拆"],
    ["TCB/微凸点键合", "逐层对准并连接", "精度、压力、温度和节拍；ASMPT等", "国内设备逐步验证", "当前主流堆叠关键", "层数增加设备时间/数量"],
    ["MR-MUF/底填", "保护互连、控翘曲和散热", "材料配方、流动/固化和可靠性", "材料国产化需客户量产验证", "SK hynix量产工艺核心", "层数提高材料/工艺价值"],
    ["混合键合", "无凸点高密度Cu-Cu/介质键合", "表面平坦/洁净、对准和检测；BESI/ASM等生态", "国产处于设备/工艺验证为主", "后续高层HBM潜在卡口，当前并非全代必用", "路线尚未全面收敛"],
    ["检测/量测", "TSV、凸点、翘曲、界面缺陷", "分辨率、吞吐和算法；KLA/Onto等", "国内设备按工序验证", "良率爬坡必需，设备集中", "堆叠复杂度提高检测步骤"],
    ["探针卡", "晶圆/堆栈并行电测", "高Pin、高速、接触一致性", "国内厂商需看HBM客户认证", "KGD和高速I/O关键", "I/O翻倍提高难度"],
    ["测试机", "功能、速度、可靠性和分选", "高速并行、热控、测试时间；Advantest/Teradyne等", "长川科技等技术可用于高端测试，HBM批量客户需验证", "测试能力可能卡产出", "位宽/速率上升提高价值"],
    ["光刻胶/临时键合胶", "TSV图形与薄化支撑", "纯度、残留、热/化学稳定", "国产替代需长认证", "材料验证壁垒高但不是全部全球唯一", "按晶圆消耗"],
    ["底部填充/模塑料", "互连保护、机械/热管理", "低翘曲、低离子、热导和可靠性", "国产材料按客户验证", "随层数与热挑战提升", "耗材重复收入但份额待核"],
    ["先进封装载板", "信号/供电和机械支撑", "大尺寸、低翘曲、高密度；日韩台供应为主", "国内载板扩产与认证阶段不一", "最终AI封装潜在卡口", "面积/层数提升，但平台路线不同"],
    ["硅中介层/桥接", "连接GPU/ASIC与HBM", "大面积良率、RDL和产能", "国内先进封装体系逐步建设", "最终系统关键，不属于HBM堆栈本身", "HBM堆栈数/封装面积驱动"],
    ["散热/TIM", "降低堆栈到冷却系统热阻", "长期可靠、泵出/老化和导热", "国产材料需平台级验证", "高层数/高速必需", "热密度提升可能增值"],
  ], note: "全球供应商仅作设备类别锚；除公司/客户正式披露外，不写成特定HBM量产份额。单机价值量无可靠公开数据时不填。" },
  { type: "heading", text: "六关筛选：真正的高确定性卡口" },
  { type: "table", headers: ["环节", "代代必用", "难绕开", "验证长", "供应集中", "层数/产能受益", "已形成收入证据", "当前结论"], rows: [
    ["TSV刻蚀/沉积/电镀", "是", "高", "长", "全球较集中", "是", "全球设备龙头有先进封装收入；HBM细分少拆", "全球工艺硬卡口；中国公司更多是国内替代逻辑"],
    ["减薄/临时键合", "高层HBM必需", "高", "长", "设备较集中", "是", "先进封装收入可见，HBM拆分不足", "值得跟踪实际HBM量产客户"],
    ["堆叠键合/底填", "是", "高", "长", "设备/材料集中", "层数越高越关键", "SK hynix量产工艺已验证", "工艺与材料联合卡口"],
    ["混合键合", "当前否", "路线未定", "长", "领先供应集中", "若采用则增值", "HBM大规模收入待验证", "红/黄档路线，不能提前按全面渗透"],
    ["测试/探针", "是", "高", "长", "高端较集中", "I/O/层数升级", "行业收入可见，HBM细分不足", "经常被忽略的有效产出卡口"],
  ] },
  { type: "company-mapping", title: "设备材料公司与客户证据", sector: "hbm" },
  sources(["naura-2025-ar", "gltech-2025-ar", "skhynix-hbm3e-12h", "samsung-hbm4-2026"]),
];

const supplyDemand: ContentBlock[] = [
  { type: "heading", text: "供需模型：先建单位链，再填可验证数据" },
  { type: "lead", text: "良品HBM需求 = AI加速器实际出货 × 每颗加速器HBM堆栈数 × 单堆栈容量。良品供给 = 晶圆投入 × 每片Good Die数 × TSV/减薄/堆叠良率 × 最终测试通过率，并受Base Die和先进封装配套约束。晶圆投入量绝不能直接当良品出货量。" },
  { type: "table", headers: ["变量", "单位", "数据优先级", "当前处理", "常见错误"], rows: [
    ["加速器出货", "颗/系统", "客户/芯片公司财报和交付", "按平台、年份、训练/推理拆", "用行业TAM替代出货"],
    ["HBM堆栈数", "stack/加速器", "官方系统配置", "不同GPU/ASIC分别填", "固定堆栈数套所有平台"],
    ["单栈容量", "GB/stack", "产品数据表", "按代际/层数", "用最大规划容量"],
    ["代际渗透率", "%", "系统出货/客户配置", "公司披露与机构预测分栏", "把送样当渗透"],
    ["规划产能", "wafer/stack/月", "公司公告", "单独展示", "等同实际产出"],
    ["实际产出/良率", "良品/月、%", "公司/客户双方或审计披露", "无数据留空", "引用传闻填数"],
    ["先进封装配套", "封装片/月", "代工/封装公司披露", "与HBM产能取最小约束", "把扩产相加"],
    ["价格/长约/库存", "美元/GB或stack、期间", "合同/财报/多源", "无统一可靠数据留空", "把现货DRAM价格套HBM"],
  ] },
  { type: "heading", text: "谨慎/中性/乐观情景（只定义输入，不伪造数字）" },
  { type: "table", headers: ["情景", "加速器/搭载", "良率/封装", "价格/库存", "必须披露的来源属性"], rows: [
    ["谨慎", "下游交付延期、旧代际占比更高", "良率爬坡慢，配套封装受限", "扩产后价格下降/库存上升", "公司披露+系统根据公开公式计算；空输入不计算"],
    ["中性", "按已公布平台和客户部署节奏", "良率逐步改善，封装同步扩", "长约与新代际溢价逐步回落", "公司披露优先，机构预测单独标"],
    ["乐观", "平台按期且高容量/新代际渗透快", "高层良率和先进封装提前改善", "供需偏紧、价格韧性", "机构预测/系统情景，不得写成事实"],
  ], note: "当前公开资料不足以用同口径填满三大厂实际良品产出、良率和ASP，因此本版保留模型结构，不生成伪精确市场规模。" },
  { type: "research-catalysts", title: "供需与产能关键事件", sector: "hbm" },
  sources(["samsung-hbm4-2026", "skhynix-hbm3e-12h", "micron-2025-10k", "alphabet-2025-q4"]),
];

const customers: ContentBlock[] = [
  { type: "heading", text: "厂商格局：每个客户平台单独记录" },
  { type: "table", headers: ["厂商", "当前锚定代际", "客户/阶段", "量产/产能/良率", "技术位置", "下一认证/风险"], rows: [
    ["SK hynix", "HBM3E 12-high已量产；HBM4按最新披露更新", "HBM3E搭载主要AI平台；HBM4曾于2025-03送样", "HBM3E量产明确；实际产出/良率未披露", "Advanced MR-MUF和客户先发", "HBM4各客户量产与份额"],
    ["Samsung", "HBM4量产/商业发货；HBM4E送样", "AMD MI455X合作为双方确认；其他客户未具名", "公司称HBM4量产，产出/良率数未披露", "1c DRAM+4nm逻辑Base Die垂直整合", "把MOU转为具名批量采购；HBM4E认证"],
    ["Micron", "HBM3E出货、HBM4按10-K路线", "客户/平台按公司披露逐项", "收入和节点按财报；产品级良率未披露", "1-gamma与HBM路线", "HBM4客户资格和volume production"],
  ], note: "不根据行业媒体给三家厂商填未经官方确认的客户份额和良率。" },
  { type: "heading", text: "客户认证时间轴" },
  { type: "supply-chain", title: "从开发到批量", items: [
    { eyebrow: "研发", title: "开发完成→送样", text: "供应商规格达标并向特定客户送样。" },
    { eyebrow: "实验", title: "功能→可靠性", text: "读写、带宽、功耗、热、寿命和工艺一致性测试。" },
    { eyebrow: "平台", title: "系统验证→认证", text: "与GPU/ASIC、Base Die、封装、板卡和软件共同验证。", highlight: true },
    { eyebrow: "商业", title: "小批量→批量供货", text: "良率稳定、配套封装就绪并进入终端系统出货。" },
  ], conclusion: "“已供货”必须追问供的是样品、小批还是量产良品，以及最终系统是否出货。" },
  { type: "research-assets", title: "HBM厂商与产品认证卡", sector: "hbm", recordType: "hbm-product" },
  sources(["samsung-hbm4-2026", "samsung-hbm4-amd-2026", "samsung-hbm4e-2026", "skhynix-hbm4-2025", "micron-2025-10k"]),
];

const china: ContentBlock[] = [
  { type: "heading", text: "中国供应链四档：应用可行性不等于HBM量产" },
  { type: "table", headers: ["环节", "已进入全球HBM量产链", "国内客户/验证", "相近技术未验证", "仅概念", "当前证据边界"], rows: [
    ["DRAM", "公开可验证中国供应商：待补", "国内DRAM制造能力存在，具体HBM认证待披露", "—", "—", "不能用DRAM量产外推HBM"],
    ["Base Die", "待补", "逻辑代工/设计能力需按客户项目", "通用逻辑工艺", "只谈先进制程", "HBM4定制与客户分工未公开"],
    ["TSV刻蚀/沉积/电镀", "全球HBM客户待补", "北方华创称进入国内头部存储厂批采", "多家设备具备先进封装能力", "只写可用于TSV", "国内量产客户≠全球HBM客户"],
    ["减薄/切割", "待补", "光力科技称先进封装批量销售", "设备可适配薄晶圆", "只有产品规划", "先进封装批量≠HBM批量"],
    ["堆叠/键合", "待补", "国内产线验证按厂商公告", "TCB/混合键合样机", "专利/概念", "需具名客户、设备台数和量产节拍"],
    ["检测/测试", "待补", "高端测试设备在国内客户验证", "可测先进封装/存储", "仅产品宣传", "需HBM高速/高Pin量产证明"],
    ["载板/中介层", "全球客户待补", "国内先进封装客户逐项验证", "具备相近工艺", "只有扩产计划", "最终GPU封装与HBM堆栈产能分开"],
    ["封装/散热材料", "待补", "底填/MUF/TIM按客户认证", "材料指标接近", "只讲国产替代空间", "配方通过测试不等于商业批"],
  ] },
  { type: "callout", tone: "warn", text: "严格区分“设备可以用于先进封装”“设备进入国内存储厂”“设备用于HBM试验线”“设备用于HBM批量生产”“设备进入全球三大HBM厂”。本版只把有正式年报支撑的层级写入对应档位。" },
  { type: "company-mapping", title: "中国上市公司HBM证据卡", sector: "hbm" },
  sources(["naura-2025-ar", "gltech-2025-ar"]),
];

const certainty: ContentBlock[] = [
  { type: "heading", text: "核心锚" },
  { type: "lead", text: "产品规格确定 → 客户送样 → 客户认证 → 良率稳定 → 批量生产 → 先进封装配套 → 最终客户系统出货 → 收入和利润兑现。" },
  { type: "unified-certainty", title: "HBM绿黄红确定性地图", sector: "hbm" },
  { type: "heading", text: "五项持续跟踪" },
  { type: "table", headers: ["观察项", "必须带的口径", "绿档", "黄/红档"], rows: [
    ["客户认证", "客户+平台+阶段+日期", "双方确认并批量", "单方送样/未具名"],
    ["良率", "工序/产品/期间", "量产稳定且可验证", "目标值/传闻/无数据"],
    ["层数/容量/Base Die", "量产产品而非目标", "终端系统采用", "样品/路线图"],
    ["扩产设备订单", "设备到厂/验收/产线", "形成稳定良品产出", "厂房/规划/意向"],
    ["出货/价格/财务", "良品stack、ASP、收入/毛利", "产品财务可验证", "晶圆投入或行业预测"],
  ] },
  { type: "research-catalysts", title: "HBM催化剂日历", sector: "hbm" },
  { type: "research-failures", title: "HBM失败与延期复盘", sector: "hbm" },
  { type: "research-sources", title: "HBM完整参考资料索引", sector: "hbm" },
];

export const hbmSector: Sector = {
  key: "hbm",
  label: "HBM",
  tagline: "从DRAM堆叠、Base Die和先进封装追到认证、良率与良品出货",
  hot: true,
  verified: true,
  nodes: ["DRAM晶圆", "TSV", "临时键合与减薄", "堆叠与键合", "Base Die", "检测与测试", "先进封装", "载板与中介层", "封装与散热材料"],
  tags: [
    { key: "overview", label: "总览", icon: "LayoutDashboard", description: "HBM定义、与普通DRAM差异、产业链、价值来源和风险。", verified: true, content: overview },
    { key: "generations", label: "产品代际与规格", icon: "Database", description: "HBM到HBM4E的标准/产品/送样/认证/量产阶段总表。", verified: true, content: generations },
    { key: "manufacturing", label: "制造与先进封装", icon: "Factory", description: "TSV、薄化、KGD、堆叠、Base Die、测试与四种产能边界。", verified: true, content: manufacturing },
    { key: "equipment-materials", label: "设备材料与卡口", icon: "Wrench", description: "设备/耗材作用、供应格局、验证和六关硬卡口筛选。", verified: true, content: equipment },
    { key: "supply-demand", label: "供需、产能与价格", icon: "ChartNoAxesCombined", description: "良品供需公式、三情景输入、产能/良率/价格口径。", verified: true, content: supplyDemand },
    { key: "qualification-vendors", label: "客户认证与厂商格局", icon: "ShieldCheck", description: "三大厂产品阶段、客户认证时间轴和下一关键验证。", verified: true, content: customers },
    { key: "china-supply-chain", label: "中国供应链映射", icon: "MapPinned", description: "全球量产、国内验证、相近技术和概念关联四档。", verified: true, content: china },
    { key: "certainty-map", label: "确定性地图", icon: "ShieldCheck", description: "从规格到财务的绿黄红分层、催化剂和失败复盘。", verified: true, content: certainty },
  ],
};
