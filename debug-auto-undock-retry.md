# Debug Session: auto-undock-retry
- **Status**: [OPEN]
- **Issue**: 自动下发导航后未能按预期自动退桩并重试导航，但手动下发退桩指令可以成功。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-auto-undock-retry.ndjson

## Reproduction Steps
1. 本地运行 `web-pcd-viewer`。
2. 导入包含充电点的路线。
3. 机器人位于充电桩上时点击开始任务。
4. 观察首次导航下发、自动退桩和重试导航的行为。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 首次导航返回的错误码不在自动退桩重试集合中，导致分支未触发 | High | Low | Rejected |
| B | 自动退桩分支已命中，但 `charge=2` 请求未真正发出或被本地 API 拦截 | High | Med | Rejected |
| C | 自动退桩已发出，但重试导航过早，机器人尚未完成退桩 | Med | Med | Confirmed |
| D | 自动触发和手动触发的充电参数/时机不同，导致手动可用而自动不可用 | Med | Low | Confirmed |
| E | 首次导航失败属于其他错误路径，逻辑直接中止，没有进入补救流程 | Med | Low | Confirmed |

## Log Evidence
- 首次修复前存在启动竞态：`dispatchTaskPoint` 入口即因 `runId` 不匹配返回，见 `.dbg/trae-debug-log-auto-undock-retry.ndjson` 早期记录。
- 最新实机日志表明已识别首点为充电点，并在导航前命中了自动退桩分支。
- 最新实机日志表明自动退桩实际下发的是 `charge=2`，且机器人返回 `errorCode=0`，说明请求已成功送达。
- 最新实机日志表明随后导航返回 `8962 (0x2302)` 并进入异常结束，而不是进入正常导航。
- 用户补充说明：手动可成功退桩的命令是 `Charge=0`，不是 `Charge=2`。
- 切换为 `Charge=0` 后，日志显示退桩成功返回时间为 `16:14:35.281`，首次导航异常 `0xA34E` 返回时间为 `16:14:37.870`，间隔约 `2.6s`。
- 同一轮自动重试再次在 `16:14:37.887` 下发 `Charge=0`，并在 `16:14:40.465` 收到第二次 `0xA34E`，再次仅间隔约 `2.6s`。
- 这说明之前实现确实在退桩尚未完成时就再次下发导航，符合现场“站起后立刻趴下”的现象。

## Verification Conclusion
- 当前根因已收敛到命令选择错误：自动逻辑使用了 `Charge=2`，但现场可用的物理退桩命令是 `Charge=0`。
- 当前根因进一步收敛到两点：自动退桩命令应使用 `Charge=0`，且导航下发时机过早。
- 已将自动退桩命令改为 `Charge=0`，并把退桩等待时间从 `1500ms` 提高到 `8000ms`；若起始充电点已发过一次退桩，则重试前只等待，不再立刻补发第二次退桩指令。
