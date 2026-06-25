# Debug Session: alarm-light-failure

Status: [OPEN]

## Symptom

- 云台接口可以成功调用
- 报警灯接口调用失败
- 用户提供了完整 API 文档：`/home/wzy/open-inspection-platform/api_reference.md`

## Hypotheses

| ID | Hypothesis | Severity | Confidence | Status |
| --- | --- | --- | --- | --- |
| A | 报警灯接口的请求字段与文档不一致，例如字段名、类型或必填项不匹配 | High | Med | Pending |
| B | 报警灯接口虽然 HTTP 成功，但前端对业务返回体的成功判定路径取值错误 | High | High | Pending |
| C | 本地 Vite 代理在 `/api/agent/light/control` 转发时改写了 body，导致实际发给 Agent 的参数不对 | High | Med | Pending |
| D | 报警灯接口需要与 Swagger 示例一致的特定请求头或编码格式，而当前前端/代理未满足 | Med | Low | Pending |
| E | 报警灯接口真实返回结构与手动调用一致，但前端动作编排把失败归因到了报警灯前置状态或时序 | Med | Low | Pending |

## Evidence Plan

1. 对照 `api_reference.md` 核对报警灯接口定义、请求参数和返回结构
2. 核对前端 `submitAgentLightControl()` 与本地代理 `/api/agent/light/control` 的实现
3. 只添加调试插桩，记录前端发起参数、代理转发参数、Agent 返回体
4. 复现一次失败路径，基于日志判断根因
5. 根据证据做最小修复，再做 post-fix 验证
