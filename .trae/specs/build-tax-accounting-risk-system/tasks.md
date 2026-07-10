# Tasks

- [x] Task 1: 项目脚手架与基础设施
  - [x] SubTask 1.1: 初始化前后端项目结构（后端API + 前端SPA）
  - [x] SubTask 1.2: 搭建数据库与基础迁移机制
  - [x] SubTask 1.3: 实现用户认证与角色权限框架（管理员/会计/审计/查询）

- [x] Task 2: 纳税人主体管理
  - [x] SubTask 2.1: 设计纳税人主体数据模型（含纳税人类型字段）
  - [x] SubTask 2.2: 实现小规模纳税人与一般纳税人两套科目体系初始化数据
  - [x] SubTask 2.3: 实现主体CRUD与按类型加载科目体系接口

- [x] Task 3: 凭证记账模块
  - [x] SubTask 3.1: 实现科目、凭证、凭证明细数据模型
  - [x] SubTask 3.2: 实现凭证录入（含借贷平衡校验）
  - [x] SubTask 3.3: 实现凭证审核、过账、作废（已过账需红冲）
  - [x] SubTask 3.4: 实现期末损益结转
  - [x] SubTask 3.5: 实现科目余额实时计算

- [x] Task 4: 财务报表模块
  - [x] SubTask 4.1: 实现资产负债表生成（支持月/季/年）
  - [x] SubTask 4.2: 实现利润表生成
  - [x] SubTask 4.3: 实现现金流量表生成
  - [x] SubTask 4.4: 实现科目余额表、明细账、总账查询
  - [x] SubTask 4.5: 实现凭证变动后报表数据重算

- [x] Task 5: 数据上传与导入模块
  - [x] SubTask 5.1: 实现发票数据导入（XML/Excel解析、进销项归类、去重）
  - [x] SubTask 5.2: 实现银行流水导入
  - [x] SubTask 5.3: 实现工资表导入
  - [x] SubTask 5.4: 实现导入校验与错误行标注/重导

- [x] Task 6: 税务申报模块
  - [x] SubTask 6.1: 实现一般纳税人增值税申报表（主表+附列资料一至五）数据归集与生成
  - [x] SubTask 6.2: 实现小规模纳税人增值税申报表生成
  - [x] SubTask 6.3: 实现企业所得税预缴/汇算清缴申报表
  - [x] SubTask 6.4: 实现附加税、个人所得税、印花税申报表
  - [x] SubTask 6.5: 实现申报状态跟踪（草稿/待申报/已申报/已缴款）

- [x] Task 7: 税务风险监控模块（核心）
  - [x] SubTask 7.1: 设计风险指标库数据模型，内置9类基础风险指标及阈值
  - [x] SubTask 7.2: 实现风险扫描引擎，支持数据上传/凭证过账后异步触发扫描
  - [x] SubTask 7.3: 实现风险事件分级（高/中/低）与预警推送
  - [x] SubTask 7.4: 实现风险整改任务分配与状态跟踪
  - [x] SubTask 7.5: 实现风险阈值可配置与历史数据重扫
  - [x] SubTask 7.6: 实现风险看板（数量、等级分布、整改率、环比趋势）

- [x] Task 8: 权限与审计
  - [x] SubTask 8.1: 实现角色权限校验中间件
  - [x] SubTask 8.2: 实现关键操作审计日志（不可篡改）

- [x] Task 9: 集成验证
  - [x] SubTask 9.1: 编写端到端测试：凭证录入→报表→申报→风险预警
  - [x] SubTask 9.2: 编写9类风险指标命中测试用例

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 依赖 Task 2
- Task 4 依赖 Task 3
- Task 5 依赖 Task 2
- Task 6 依赖 Task 3、Task 5
- Task 7 依赖 Task 3、Task 5
- Task 8 依赖 Task 1
- Task 9 依赖 Task 3、Task 4、Task 6、Task 7
