# Ghost in the Wire — Development Roadmap (Optimized)

> 更新说明：本路线图已根据当前原型实装情况进行迭代，明确了“已完成 / 进行中 / 下一步优化”。

## Phase 1 — Vertical Slice Foundation (✅ Completed)
- [x] 高对比视觉基调：深黑背景 + Neon Cyan + Glitch Red
- [x] 玩家“电流幽灵”基础移动与闪烁表现
- [x] Wire 网络（静态线路）与最近线路吸附
- [x] `Space` Snap Dash：吸附后沿线高速滑行（3x）
- [x] 高速运动 Glitch（RGB Split + 拖影）
- [x] 敌人碰撞击杀后“夺舍”粒子重构
- [x] Sync 稳定值衰减与低稳定度失真反馈（抖屏/输入扰动/2x伤害）

## Phase 2 — Gameplay Reliability & Readability (✅ Completed)

> 当前迭代：已完成命中/受击音效脉冲与受击闪屏反馈，Phase 2 收官。
- [x] 线路邻近高亮与可吸附预判（降低操作不确定性）
- [x] 线路网络由“随机散线”升级为“可导航主干 + 支线”结构
- [x] Dash 链接段衔接逻辑（端点附近自动跳线，提升流动感）
- [x] Sync 风险提示强化（HUD闪烁、低Sync色偏加重）
- [x] 敌人行为状态机（巡逻 / 追踪 / 闪避）
- [x] 命中与受击的音效层（电子噪声、失真脉冲）

## Phase 3 — Combat Depth & Roguelike Loop (✅ Completed)
- [x] 程序化房间 + 路径生成（围绕“Wire密度”设计战斗节奏）
- [x] 武器/技能模块化（例如：链路过载、短路爆发、镜像残影）

> 当前迭代：已落地“房间+线网密度”原型，并支持 `R` 快速重生关卡种子。
> 新增：夺舍后临时继承敌人特性（swift/tank/volatile），持续时间可见于 HUD。
> 新增：技能模块原型（Overload / Short Circuit / Mirror Echo）及独立冷却显示。
> 新增：Meta 进度原型（shards 解锁协议 + Q 切换协议 + 风险收益差异）。
> 新增：波次推进 + 连击积分回路，提升战斗节奏与成长反馈。
> 新增：精英波次敌人（高威胁/高收益），强化风险收益决策。
- [x] 夺舍后临时继承敌人特性（移动、攻速、子弹形态）
- [x] Meta 进度（解锁新Ghost协议、风险换收益）

## Phase 4 — Performance & Productionization (✅ Completed)

> 当前迭代：新增：已引入 trail/particle 对象池，降低高频特效下的 GC 抖动。
> 新增：静态层缓存 + 性能档位切换（P），为低性能设备提供降载路径。
> 新增：自动化回归探针（frame/dash/input latency 阈值检查）。
> 新增：自动性能治理器（G），按帧时动态切换 high/low 档位。
> 新增：触控输入（左区移动 + 右区触发 Dash）用于移动端可玩性。
> 新增：HUD/UI 信息分层优化（玻璃态面板、状态图例、移动端布局收敛）。
> 新增：Wire 连接点图与方向对齐链路切换，降低断链与误跳线。
> 新增：自选关卡设置（seed/起始波次/密度倍率），提升可控测试与玩法自定义。
- [x] 画布渲染分层缓存（静态层/动态层）
- [x] 粒子池与对象池优化（减少GC抖动）
- [x] 移动端输入与自适应性能档位
- [x] 自动化回归脚本（核心手感指标：Dash成功率、帧时间、输入延迟）

## Optimization Principles (长期有效)
1. **Readability first**：再“炫”的特效也不能牺牲可读性。
2. **Flow over friction**：线路切换和 Dash 反馈必须让玩家感到“电流滑行”。
3. **Risk-reward clarity**：低 Sync 的风险与收益必须直观可感。
4. **Performance budget**：优先保证稳定帧率，再追加视觉复杂度。
