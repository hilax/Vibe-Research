import { sourceItems } from "@/data/research";
import type { ContentBlock, Sector } from "@/data/sectors";

const sources = (ids: string[]): ContentBlock => ({ type: "sources", items: sourceItems(ids) });

const overview: ContentBlock[] = [
  { type: "heading", text: "1. 一句话定性" },
  { type: "lead", text: "光互联的本质，是在AI集群中用光信号承担高速、较远距离和高带宽密度的数据传输，解决电互联在距离、带宽密度、功耗和信号完整性方面的限制。并不是所有距离都必须使用光：距离、拓扑、功耗、成本和维护共同决定铜光边界。" },
  { type: "heading", text: "2. 光互联在AI集群中的位置" },
  { type: "table", headers: ["层级", "典型距离/位置", "可选介质", "光何时更可能采用"], rows: [
    ["芯片间/封装内", "毫米—厘米", "片上/封装互联、未来光I/O探索", "带宽密度和电距离到极限，但量产/封装仍是门槛"],
    ["板内/服务器内", "厘米—米", "PCB、连接器、AEC/DAC、板载光", "电损耗/retimer功耗过高或物理布线困难"],
    ["机柜内", "米级", "DAC、AEC、专用铜互联、光模块/光引擎", "速率和距离超过铜经济边界"],
    ["机柜间/数据中心内", "数米—公里", "DAC/AEC（短距）、可插拔光、CPO出口", "大部分较长链路和高端口密度采用光"],
    ["数据中心间", "公里—城域/长途", "相干光、传送网络", "必须满足距离、容量和频谱效率"],
  ], note: "距离只是变量之一；同样长度下，端口速率、线缆密度、弯曲半径、可维护性和每比特功耗会改变方案。" },
  { type: "table", headers: ["方案", "本质", "优势", "局限"], rows: [
    ["PCB走线", "板上传输", "成本低、无需线缆", "高速长距损耗大"],
    ["DAC", "无源铜缆", "低时延/低功耗/低成本", "距离和线径受限"],
    ["AEC", "带均衡/重定时的有源铜缆", "比DAC更长且可维护", "功耗/成本高于DAC，仍受铜限制"],
    ["可插拔光模块", "面板可更换光电转换", "标准化、可维护、供应生态成熟", "DSP/SerDes功耗、面板密度与热"],
    ["板载光学", "光引擎位于板上", "缩短主机电距离", "维修与标准化弱于可插拔"],
    ["CPO", "光引擎靠近交换/计算ASIC共封装", "带宽密度和每比特功耗潜力", "封装良率、散热、光源和维护成本"],
  ] },
  { type: "heading", text: "3. 为什么当前值得研究" },
  { type: "theses", items: [
    { title: "交换容量与Lane速率升级", body: "Broadcom Tomahawk 6达到102.4Tb/s并支持200G SerDes；IEEE P802.3dj推进1.6Tb/s。交换ASIC决定端口速率和潜在光模块规格。" },
    { title: "800G向1.6T迁移", body: "Ethernet Alliance 2026路线图将1.6T、LPO和高效铜/光列为演进方向；方向证据不等于所有客户已批量。" },
    { title: "光向更短距渗透存在条件", body: "机架级scale-up提高带宽密度，但更短距离仍需与DAC/AEC在功耗、时延、成本和维护上竞争。" },
  ] },
  { type: "callout", tone: "warn", text: "任何“光模块数量随GPU固定倍数增长”的测算都不可靠，除非同时写明GPU数、服务器NIC数、拓扑、交换层数、冗余、端口利用、模块单双端和铜光比例。" },
  { type: "heading", text: "4. 产业地图" },
  { type: "supply-chain", title: "器件到网络", items: [
    { eyebrow: "芯片", title: "光芯片＋DSP＋模拟芯片", text: "EML/VCSEL/CW激光、硅光、Driver、TIA、DSP和交换SerDes。" },
    { eyebrow: "光学", title: "FAU/连接器/无源器件", text: "光纤阵列、MPO/MT、AWG/PLC、陶瓷套管与精密耦合。" },
    { eyebrow: "制造", title: "光学封装＋测试", text: "贴片、耦合、主动/被动对准、老化和高速测试决定良率。", highlight: true },
    { eyebrow: "系统", title: "模块/光引擎→交换机/服务器", text: "最终进入AI前后端、scale-up/out、存储和DCI网络。" },
  ], conclusion: "价值量不仅取决于模块数量，还取决于单通道速率、DSP/激光/硅光集成、连接复杂度、测试时间和良率。" },
  { type: "research-assets", title: "光互联产品卡工作台", sector: "cpo", recordType: "optical-product" },
  sources(["ethernet-roadmap-2026", "ieee-8023dj-2025", "oif-current-2026", "broadcom-th6-2025", "coherent-1-6t-2025"]),
];

const architecture: ContentBlock[] = [
  { type: "heading", text: "1. 六类网络场景" },
  { type: "table", headers: ["场景", "流量/目标", "典型协议", "铜光影响"], rows: [
    ["Scale-up", "紧耦合加速器域内高带宽低延迟", "专用互联或开放scale-up Ethernet", "短距铜占比可能高；域规模/速率提升推动部分光"],
    ["Scale-out", "跨服务器/机架扩展训练推理", "Ethernet/RoCE/UEC或InfiniBand", "柜间与多层交换产生大量光链路"],
    ["前端网络", "用户、控制、管理和通用业务", "Ethernet/IP", "速率通常低于后端但规模大"],
    ["后端训练网络", "梯度/参数/专家通信", "IB或Ethernet/RoCE/UEC", "高带宽、拥塞与无损/低丢包要求"],
    ["存储网络", "数据集、checkpoint、推理缓存", "Ethernet/NVMe-oF等", "吞吐与突发模式影响端口配置"],
    ["DCI", "跨数据中心复制/训练与服务", "相干DWDM/IP", "长距必须光，关注频谱和每比特成本"],
  ] },
  { type: "heading", text: "2. 网络拓扑" },
  { type: "table", headers: ["拓扑", "普通解释", "端口/模块影响", "风险"], rows: [
    ["Leaf-Spine/Clos", "服务器接Leaf，Leaf上联Spine，多路径并行", "服务器和上联两端都需端口；层数决定模块数", "过订阅、ECMP不均和拥塞"],
    ["Fat Tree", "各层带宽接近无阻塞，树状多级Clos", "交换机/端口多、光链路多", "成本、电力和布线"],
    ["Rail Optimized", "同一GPU rail优先连同一组交换，适配集体通信", "需按服务器GPU/NIC映射计算", "容错和跨rail流量"],
    ["Dragonfly", "高基数路由器分组，减少全局跳数", "本地/全局链路距离不同，光规格不同", "路由和拥塞管理复杂"],
    ["OCS", "用光路交换建立可重构直连", "可能减少部分电交换跳数，但需控制面与重配置", "重配置粒度、故障和业务匹配"],
  ] },
  { type: "heading", text: "3. 协议和拓扑如何改变产业链" },
  { type: "table", headers: ["变量", "模块数量", "交换机/端口", "距离/功耗", "网络芯片"], rows: [
    ["Ethernet vs InfiniBand", "由端口和拓扑决定，不由协议名固定", "生态/交换平台不同", "同速率物理层可相似", "NIC、交换ASIC和拥塞机制不同"],
    ["RoCE/UEC增强", "不会自动减少模块", "对遥测/拥塞/包处理要求提高", "可提升有效利用率", "NIC/交换功能价值增加"],
    ["多一层Spine", "增加Leaf-Spine双端链路", "交换机数量上升", "通常柜间光", "端口密度与交换容量上升"],
    ["更低过订阅", "上联数量增加", "更多Spine端口", "功耗/成本上升", "换取网络带宽"],
  ] },
  { type: "heading", text: "4. 光模块数量测算模板" },
  { type: "kv", items: [
    { term: "服务器侧链路", value: "服务器数 × 每台NIC数 × 每NIC端口数 × 光链路占比。" },
    { term: "交换上联", value: "各层交换机数 × 每台上联端口 × 启用率 × 光链路占比。" },
    { term: "模块单双端", value: "一条完整光链路通常两端各有光学端点；CPO/板载光可能改变可插拔模块口径。" },
    { term: "冗余/备件", value: "网络冗余、备用端口和维护备件单列，不混入运行端口。" },
    { term: "铜光比例", value: "按距离、速率、平台和客户设计输入，不能设为行业常数。" },
    { term: "结果边界", value: "输出端口/光学端点数量区间，并给出拓扑图和所有假设；不得只用GPU×固定倍数。" },
  ] },
  sources(["broadcom-th6-2025", "google-ironwood-2026", "ethernet-roadmap-2026"]),
];

const rates: ContentBlock[] = [
  { type: "heading", text: "速率代际总表" },
  { type: "table", headers: ["总速率", "典型单通道×数量", "调制/电接口", "常见光接口/距离", "功耗/封装", "应用与商业阶段"], rows: [
    ["100G", "4×25G NRZ或1×100G PAM4等", "NRZ/PAM4，按代际", "SR/DR/CWDM等，距离因标准", "QSFP28等；按产品数据", "云/企业成熟量产"],
    ["200G", "4×50G或2×100G", "PAM4为主", "FR/DR/SR等", "QSFP56等", "网络升级/聚合，成熟"],
    ["400G", "8×50G或4×100G", "PAM4，100G/lane电接口", "DR4/FR4/SR8/ZR等", "QSFP-DD/OSFP", "数据中心和DCI规模量产"],
    ["800G", "8×100G或4×200G", "PAM4，112G/224G电气代际并存", "DR8/2×FR4/DR4等", "OSFP/QSFP-DD；功耗按产品", "AI网络批量，平台/客户份额不同"],
    ["1.6T", "8×200G", "224G级电接口、PAM4", "DR8/2×FR4等产品路线", "OSFP1600/OSFP224等；热设计更严", "芯片、模块样品、认证和批量阶段并存"],
    ["3.2T", "可能8×400G或16×200G等公开路线", "448G/224G生态仍演进", "接口尚未全面收敛", "可插拔/CPO/光引擎路线竞争", "路线图/研发为主，不能按批量出货"],
  ], note: "典型组合不是唯一标准。每款产品仍需记录电/光接口、距离、功耗、送样、认证、量产、出货和价格；无可靠公开数据留空。" },
  { type: "heading", text: "五阶段不能混写" },
  { type: "supply-chain", title: "标准到收入", items: [
    { eyebrow: "标准", title: "标准完成", text: "定义电/光接口和互操作，不等于芯片就绪。" },
    { eyebrow: "芯片", title: "交换/DSP/光芯片推出", text: "提供实现基础，仍需模块设计和测试。" },
    { eyebrow: "模块", title: "样品→客户认证", text: "功耗、信号、热、可靠性和系统互操作。", highlight: true },
    { eyebrow: "商业", title: "小批→批量出货", text: "良率、供应、价格和客户平台同步后才形成收入。" },
  ], conclusion: "例如“展示1.6T样品”只能写在模块样品栏，不能据此填写量产时间、客户或市场份额。" },
  { type: "research-assets", title: "光模块与光引擎代际卡", sector: "cpo", recordType: "optical-product" },
  sources(["ieee-8023dj-2025", "ethernet-roadmap-2026", "coherent-1-6t-2025", "zj-inno-2024-ar"]),
];

const routes: ContentBlock[] = [
  { type: "heading", text: "技术路线之争：先回答场景" },
  { type: "table", headers: ["路线", "适用距离/场景", "功耗/成本", "维护/信号完整性", "DSP/光源/散热", "标准/量产阶段", "最可能先用的场景"], rows: [
    ["传统可插拔", "柜间、交换机面板和DCI", "DSP功耗较高但生态/成本成熟", "热插拔、易维护；电路径长", "模块内DSP；EML/硅光/VCSEL等", "800G成熟，1.6T分阶段", "大多数scale-out与前端/存储"],
    ["LPO", "主机电通道质量足够的短中距", "移除模块DSP降低功耗/时延", "依赖主机SerDes、链路训练和供应商互操作", "无完整模块DSP；仍需Driver/TIA/光源", "标准和早期产品推进", "受控同构网络/短距"],
    ["LRO/RTLR", "线性与重定时折中", "功耗介于DSP与LPO", "一侧线性/一侧重定时降低部分链路风险", "保留部分重定时功能", "OIF 112G RTLR IA已发布，224G继续推进", "需要折中互操作/功耗的场景"],
    ["CPO", "交换ASIC/XPU附近，高带宽密度", "每比特功耗潜力高，封装/维护成本复杂", "电路径最短；坏光引擎/光纤维修影响系统", "光引擎共封装，常考虑ELSFP外置激光", "标准存在，Broadcom多代产品；终端大规模采用仍分客户", "102.4T等高带宽交换平台可能先采用"],
    ["板载光学/NPO", "板上靠近ASIC", "介于可插拔与CPO", "维护比可插拔难、比CPO可分离", "光引擎板上，热/光纤路由", "多种实现，标准化较弱", "特定系统"],
    ["DAC", "最短距", "最低功耗/成本", "无光电转换，线粗/距离短", "无DSP光学；可能需主机均衡", "成熟", "柜内短距优先"],
    ["AEC", "比DAC更长的铜连接", "有源器件提高功耗/成本", "可插拔维护，改善信号", "铜缆内retimer/均衡", "成熟度按速率", "柜内/相邻柜短距"],
    ["OCS", "可重构光路交换", "可能减少电交换和O/E/O", "需调度、故障与重配置机制", "光开关+控制系统", "Google等有公开系统实践，通用采用非统一", "大规模稳定流/可预测通信"],
  ] },
  { type: "heading", text: "路线判断七问" },
  { type: "list", ordered: true, items: ["哪个网络场景和距离先采用", "哪个端口速率/SerDes节点触发", "客户还是设备商承担维护和备件成本", "激光器放在模块、板上还是ELSFP", "主机/模块/管理标准是否统一并互操作", "是否有具名客户采购而非展示或合作", "封装/耦合/测试良率和全生命周期成本能否量产"] },
  { type: "callout", tone: "warn", text: "CPO不是对所有可插拔模块的全面替代：短距铜、可插拔、LPO/LRO、板载光和CPO会按距离、速率、客户运维和可靠性长期分层共存。" },
  sources(["oif-cpo-3-2t", "oif-current-2026", "broadcom-th6-cpo-2025", "ethernet-roadmap-2026"]),
];

const bom: ContentBlock[] = [
  { type: "heading", text: "核心器件与BOM：看价值迁移" },
  { type: "table", headers: ["器件", "作用/典型用量", "技术壁垒/路线", "全球/中国供应", "速率升级价值", "集成/风险"], rows: [
    ["DSP", "每模块通常1颗（传统高速可插拔）", "PAM4均衡、FEC、功耗和先进制程", "Broadcom/Marvell等；中国高端份额需核", "200G/lane价值高", "LPO/CPO可能减少/迁移DSP价值"],
    ["Driver", "每Tx通道", "高线性、摆幅、功耗", "全球模拟芯片与模块内制", "通道速率提高难度", "可与PIC/DSP集成"],
    ["TIA", "每Rx通道", "噪声、带宽、线性", "全球/中国厂商按客户认证", "200G/lane升级", "硅光/探测器协同"],
    ["EML", "每光通道或阵列", "高速调制、良率和温控", "日美及中国供应商，客户份额需核", "单通道价值提高", "与硅光调制路线竞争"],
    ["VCSEL", "短距多模每通道", "高速、阵列一致性", "美日及中国供应", "200G/lane研发", "距离和多模生态限制"],
    ["CW激光器", "硅光/CPO连续光源", "功率、线宽、可靠性", "多家全球激光器厂；中国供应需认证", "CPO/硅光用量和功率可能提升", "外置激光改变维护/BOM"],
    ["硅光PIC", "调制/分束/耦合/探测集成", "工艺平台、设计、封装和测试", "TSMC/Intel/Broadcom/多家模块厂生态；中国平台追赶", "高通道密度受益", "集成提高但良率耦合"],
    ["调制器", "每Tx通道", "带宽、Vπ、损耗", "硅光MZM/环形、InP EML等", "速率越高壁垒越高", "可与光源/PIC集成"],
    ["光探测器", "每Rx通道", "响应度、带宽、暗电流", "InGaAs/Ge-on-Si等", "200G/lane升级", "与硅光/TIA集成"],
    ["AWG/PLC", "波分复用/分光", "插损、温漂、一致性", "全球及中国无源器件供应", "FR4/CWDM等随波数", "可被硅光集成部分替代"],
    ["FAU", "光纤阵列与芯片耦合", "亚微米对准、胶水/端面可靠性", "中国光器件封装供应链具规模，但客户认证逐项", "通道数提高价值", "CPO批量良率卡口"],
    ["MPO/MT", "多芯光纤连接", "低损耗、端面、插拔可靠性", "US Conec/康宁等全球生态及中国厂商", "纤芯/通道增加", "标准/专利/良率风险"],
    ["光纤", "每链路", "低损耗、弯曲、带宽", "Corning等及中国光纤厂", "数量随链路，单价未必同步", "布线密度和连接管理"],
    ["陶瓷套管", "连接器精密对准", "尺寸/同轴度/耐久", "日系与中国供应", "价值增幅有限", "价格竞争"],
    ["PCB", "电接口、供电和控制", "高速低损耗、散热", "全球与中国PCB厂", "224G电通道材料/工艺升级", "CPO缩短板级高速距离"],
    ["连接器", "主机/模块电连接", "高频损耗、密度、插拔", "TE/Amphenol/Molex等及中国供应", "200G/lane升级", "CPO形态改变价值"],
    ["散热材料", "模块/ASIC热路径", "热阻、可靠性和泵出", "全球及中国TIM/结构厂", "功耗密度提升", "路线降功耗可能抵消"],
    ["光引擎/封装", "PIC+激光/Driver/TIA+光纤耦合", "光电共设计、对准、测试和良率", "模块厂/硅光/CPO生态", "通道密度提升价值", "集成越高单点报废成本越高"],
  ], note: "单模块用量和价值量必须按具体DR8/FR4/SR8/LPO/CPO产品填写；无公开BOM和采购价时不填金额。" },
  sources(["broadcom-th6-cpo-2025", "coherent-1-6t-2025", "zj-inno-2024-ar", "oif-current-2026"]),
];

const manufacturing: ContentBlock[] = [
  { type: "heading", text: "设备材料与制造卡口" },
  { type: "table", headers: ["工序", "自动化/人工现状", "良率卡点", "1.6T/3.2T/CPO升级", "全球集中/中国订单证据"], rows: [
    ["外延", "晶圆级自动化", "缺陷、厚度/组分均匀性", "200G/400G光器件材料质量", "MOCVD/MBE与外延片供应集中；中国客户逐项认证"],
    ["光芯片制造", "晶圆厂自动化", "关键尺寸、耦合器/波导损耗、激光良率", "硅光/InP工艺升级", "工艺平台和PDK壁垒；批量客户证据优先"],
    ["晶圆测试", "可自动探针但光电测试复杂", "耦光、并行度和测试覆盖", "通道数/速率提高测试时间", "高端光电测试设备集中"],
    ["芯片切割", "自动化较高", "崩边、污染、薄片", "硅光/激光不同材料", "设备集中；光力科技有光学切割产品但CPO订单待核"],
    ["贴片/焊接", "可自动化", "位置、热应力和互连可靠性", "更小间距/更高集成", "高精度贴装设备与工艺"],
    ["有源对准", "仍是自动化难点，设备+算法", "逐通道找最佳耦合点", "FAU多通道/CPO通道密度增加", "高精度设备集中；中国设备批量订单需公司公告"],
    ["无源对准", "依赖晶圆级基准与高精度装配", "公差累积", "量产降成本关键", "工艺/设计协同壁垒"],
    ["光学封装", "部分工序仍需人工干预", "胶水、固化、热、应力和光纤管理", "CPO靠近大ASIC后复杂度上升", "模块厂的工艺know-how重要"],
    ["老化", "自动化机架", "筛出早期失效但占用时间/设备", "激光/光引擎高可靠要求", "老化电源、温控和测试系统"],
    ["高速/光功率测试", "自动测试但仪器昂贵", "误码、眼图、抖动、功率和互操作", "224G/448G电气与1.6T/3.2T", "Keysight/Anritsu等高端仪器集中；国产替代需量产验证"],
    ["自动化与良率管理", "MES/数据闭环逐步提升", "多工序累积、返修定位", "CPO单点缺陷影响整机", "有批量订单/产线OEE才证明兑现"],
  ] },
  { type: "callout", tone: "warn", text: "“设备能做光模块/CPO”不是订单证据。至少需要具名或可审计客户、送样/验收阶段、批量设备台数、收入确认和回款中的一项以上。" },
  { type: "company-mapping", title: "光学设备材料与中国公司证据", sector: "cpo" },
  sources(["coherent-1-6t-2025", "broadcom-th6-cpo-2025", "gltech-2025-ar", "zj-inno-2024-ar"]),
];

const companies: ContentBlock[] = [
  { type: "heading", text: "公司格局：按角色和商业阶段" },
  { type: "table", headers: ["角色", "全球锚点", "中国映射", "必须核实"], rows: [
    ["云厂商", "Alphabet、Microsoft、Amazon、Meta等", "国内云/运营商", "CapEx、网络架构、端口速率、实际采购"],
    ["交换/NIC芯片", "Broadcom、NVIDIA、Marvell等", "国内交换/NIC芯片厂", "shipping、客户部署和份额"],
    ["交换机", "Arista/Cisco及ODM生态", "新华三/中兴/锐捷及ODM", "平台、客户、端口和交付"],
    ["光模块", "Coherent/Lumentum等", "中际旭创、新易盛、光迅科技等", "送样/验证/批量、客户与速率收入"],
    ["光芯片/硅光/DSP", "Broadcom/Marvell/Coherent等", "中国光芯片和硅光平台", "器件客户认证、良率和收入"],
    ["连接器/材料/设备", "Corning/Amphenol/Keysight等", "中国连接器、FAU、测试/封装设备厂", "是否进入1.6T/CPO批量而非泛光通信"],
  ] },
  { type: "company-mapping", title: "全球与中国公司订单证据表", sector: "cpo" },
  { type: "research-assets", title: "产品送样/认证/批量状态", sector: "cpo", recordType: "optical-product" },
  { type: "research-catalysts", title: "光互联催化剂日历", sector: "cpo" },
  sources(["broadcom-th6-2025", "broadcom-th6-cpo-2025", "coherent-1-6t-2025", "zj-inno-2024-ar"]),
];

const certainty: ContentBlock[] = [
  { type: "heading", text: "核心锚" },
  { type: "lead", text: "网络架构确定 → 交换芯片和端口速率确定 → 模块规格确定 → 光芯片和BOM确定 → 客户认证 → 良率稳定 → 批量出货 → 收入和利润兑现。" },
  { type: "unified-certainty", title: "光互联绿黄红确定性地图", sector: "cpo" },
  { type: "table", headers: ["档位", "产品/场景", "客户", "量产/财务", "行动边界"], rows: [
    ["绿档", "规格和应用明确", "头部客户认证", "批量且收入/份额可验证", "继续看价格、良率和下一代"],
    ["黄档", "方向明确但路线/份额未定", "已送样/验证", "小批或良率未稳", "不把行业空间乘到公司"],
    ["红档", "标准/概念/实验室样品", "无采购", "成本维护良率未解", "重点跟踪，不提前按全面渗透"],
  ] },
  { type: "research-catalysts", title: "光互联催化剂日历", sector: "cpo" },
  { type: "research-failures", title: "光互联失败与延期复盘", sector: "cpo" },
  { type: "research-sources", title: "光互联完整参考资料索引", sector: "cpo" },
];

export const opticalSector: Sector = {
  key: "cpo",
  label: "光互联",
  tagline: "从网络拓扑和端口速率追到BOM、认证、良率和批量订单",
  hot: true,
  verified: true,
  nodes: ["交换与网络芯片", "DSP/Driver/TIA", "激光器与光芯片", "硅光PIC", "无源光器件", "FAU与连接器", "光学封装", "高速测试", "光模块与光引擎", "数据中心网络"],
  tags: [
    { key: "overview", label: "总览", icon: "LayoutDashboard", description: "铜光边界、集群位置、研究逻辑、产业地图和产品卡。", verified: true, content: overview },
    { key: "ai-network", label: "AI网络架构", icon: "Network", description: "六类网络、拓扑、协议和显式输入的数量模型。", verified: true, content: architecture },
    { key: "rate-generations", label: "光模块与速率代际", icon: "Cable", description: "100G到3.2T、通道/接口/距离和标准到批量阶段。", verified: true, content: rates },
    { key: "technology-routes", label: "技术路线之争", icon: "GitBranch", description: "可插拔、LPO/LRO/CPO、板载光、DAC/AEC和OCS。", verified: true, content: routes },
    { key: "core-bom", label: "核心器件与BOM", icon: "Boxes", description: "DSP、光芯片、硅光、连接器、FAU和封装价值迁移。", verified: true, content: bom },
    { key: "manufacturing", label: "设备材料与制造卡口", icon: "Wrench", description: "外延、耦合对准、封装、老化、高速测试和良率。", verified: true, content: manufacturing },
    { key: "companies-orders", label: "公司格局与订单", icon: "Factory", description: "云、芯片、交换机、模块、器件、连接和设备公司阶段。", verified: true, content: companies },
    { key: "certainty-map", label: "确定性地图", icon: "ShieldCheck", description: "从网络架构到财务兑现的绿黄红、催化剂和失败复盘。", verified: true, content: certainty },
  ],
};
