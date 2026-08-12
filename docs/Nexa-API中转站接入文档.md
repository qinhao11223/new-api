# Nexa 接入 API 中转站文档

## 1. 接入目标

将 Nexa 的模型请求统一发送到我们的 OpenAI 兼容 API 中转站。

- API Base URL：`https://async-api.nexaapp.cn/v1`
- 协议：OpenAI Compatible API
- 鉴权：HTTP Bearer Token
- 推荐接口：`POST /chat/completions`
- 模型列表：`GET /models`
- 计费币种：USD

> `usage.billing` 需要服务器部署包含 `include_billing` 功能的新版本后才会返回。

## 2. Nexa 需要配置的内容

在 Nexa 的 OpenAI、自定义 OpenAI 或 OpenAI Compatible Provider 配置中填写：

| 配置项 | 内容 |
|---|---|
| Provider 类型 | OpenAI Compatible |
| Base URL | `https://async-api.nexaapp.cn/v1` |
| API Key | 在中转站“API 密钥”页面创建的下游密钥 |
| 默认模型 | 从 `GET /v1/models` 返回结果中选择 |

Base URL 不要填写到 `/chat/completions`，只填写到 `/v1`。

API Key 示例仅使用占位符：

```text
sk-your-downstream-api-key
```

禁止将云雾或 GRS AI 的上游密钥交给 Nexa。Nexa 只能使用中转站创建的下游 API Key。

## 3. 当前可用文本模型

实际可用模型以 `GET /v1/models` 的实时结果为准。当前接入的模型包括：

```text
gpt-5.6-sol
gpt-5.5
gpt-5.4
gemini-3-flash
gemini-3.5-flash
gemini-3.1-flash-lite
gemini-3.1-pro
gemini-3-pro
gemini-2.5-flash
gemini-2.5-pro
```

查询模型：

```bash
curl 'https://async-api.nexaapp.cn/v1/models' \
  -H 'Authorization: Bearer sk-your-downstream-api-key'
```

## 4. 非流式对话调用

```bash
curl 'https://async-api.nexaapp.cn/v1/chat/completions' \
  -H 'Authorization: Bearer sk-your-downstream-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [
      {
        "role": "user",
        "content": "你好，请介绍一下你自己。"
      }
    ],
    "stream": false,
    "include_billing": true
  }'
```

响应示例：

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1784900000,
  "model": "gemini-3.5-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 30,
    "total_tokens": 150,
    "billing": {
      "currency": "USD",
      "total_cost": 0.000064,
      "billing_mode": "ratio",
      "billing_source": "wallet",
      "group_ratio": 1,
      "input_unit_price_per_million": 0.1766290348695153,
      "output_unit_price_per_million": 1.4719086239126278
    }
  }
}
```

## 5. 流式调用

```bash
curl -N 'https://async-api.nexaapp.cn/v1/chat/completions' \
  -H 'Authorization: Bearer sk-your-downstream-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [
      {
        "role": "user",
        "content": "写一段简短的产品介绍。"
      }
    ],
    "stream": true,
    "stream_options": {
      "include_usage": true
    },
    "include_billing": true
  }'
```

流式响应使用 SSE。Nexa 应当：

1. 按顺序拼接每个数据块中的 `choices[].delta.content`。
2. 在最终 usage 数据块中读取 `usage.billing`。
3. 收到 `data: [DONE]` 后结束本次请求。
4. 不要尝试从中间文本数据块计算费用。

## 6. 价格字段说明

启用 `"include_billing": true` 后，价格位于：

```text
response.usage.billing
```

| 字段 | 类型 | 说明 |
|---|---:|---|
| `currency` | string | 当前固定为 `USD` |
| `total_cost` | number | 本次请求最终计费金额，应作为权威费用 |
| `billing_mode` | string | `ratio`、`fixed` 或 `tiered_expr` |
| `billing_source` | string | `wallet` 或 `subscription`，可能省略 |
| `group_ratio` | number | 本次请求使用的分组倍率 |
| `input_unit_price_per_million` | number | 每百万输入 token 的实际单价，动态定价时可能省略 |
| `output_unit_price_per_million` | number | 每百万输出 token 的实际单价，动态定价时可能省略 |
| `request_price` | number | 按次计费模型的单次价格，按 token 计费时省略 |
| `matched_tier` | string | 表达式定价命中的价格档位，非表达式定价时省略 |

接入规则：

- Nexa 结算或展示本次费用时只使用 `total_cost`。
- 不要自行使用 token 数量重新计算最终费用。
- 缓存、工具调用、阶梯定价和分组倍率都可能使简单乘法产生误差。
- `gpt-5.4` 使用表达式定价，可能只返回 `total_cost`、`billing_mode` 和 `matched_tier`，单位价格字段允许缺失。
- 未设置 `include_billing` 时，响应保持标准 OpenAI 格式，不返回 `usage.billing`。

## 7. Python SDK 示例

OpenAI SDK 不直接声明 `include_billing` 参数，需要使用 `extra_body`：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-downstream-api-key",
    base_url="https://async-api.nexaapp.cn/v1",
)

response = client.chat.completions.create(
    model="gemini-3.5-flash",
    messages=[
        {"role": "user", "content": "你好"}
    ],
    extra_body={
        "include_billing": True
    },
)

print(response.choices[0].message.content)
print(response.usage)
```

如果 SDK 没有将扩展字段映射为对象属性，应读取原始 JSON，或者使用普通 HTTP 客户端读取 `usage.billing`。

## 8. JavaScript 示例

```javascript
const response = await fetch(
  'https://async-api.nexaapp.cn/v1/chat/completions',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NEXA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-3.5-flash',
      messages: [
        { role: 'user', content: '你好' },
      ],
      stream: false,
      include_billing: true,
    }),
  },
);

if (!response.ok) {
  throw new Error(`API request failed: ${response.status}`);
}

const data = await response.json();
console.log(data.choices[0].message.content);
console.log(data.usage?.billing?.total_cost);
```

## 9. Responses API

如 Nexa 使用 OpenAI Responses API，也可以调用：

```bash
curl 'https://async-api.nexaapp.cn/v1/responses' \
  -H 'Authorization: Bearer sk-your-downstream-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "input": "你好",
    "include_billing": true
  }'
```

价格同样读取 `usage.billing.total_cost`。

优先使用 `/chat/completions`；只有 Nexa 明确依赖 Responses API 功能时才使用 `/responses`。

## 10. 错误处理

常见 HTTP 状态：

| 状态码 | 处理建议 |
|---:|---|
| `400` | 请求参数或模型名称错误，不要原样重试 |
| `401` | API Key 无效或未携带 |
| `403` | 当前密钥或分组无权访问该模型 |
| `429` | 触发速率限制，按指数退避重试 |
| `500` | 中转站内部错误，可有限次数重试 |
| `502`、`503`、`504` | 上游暂时不可用，可有限次数重试 |

重试建议：

- `429`、`500`、`502`、`503`、`504` 最多重试 2 次。
- 建议退避时间为 1 秒、3 秒。
- 流式请求已经收到内容后，不要自动重试，否则可能产生重复内容和重复费用。

## 11. Nexa 接入验收

接入完成后依次验证：

1. `GET /v1/models` 能返回模型列表。
2. 使用 `gemini-3.5-flash` 完成一次非流式请求。
3. 响应包含 `usage.prompt_tokens`、`usage.completion_tokens`。
4. 设置 `include_billing: true` 后包含 `usage.billing.total_cost`。
5. 完成一次流式请求，并能在最终 usage 数据块读取费用。
6. 切换到 `gpt-5.4`，确认可以处理 `billing_mode: "tiered_expr"`。
7. Nexa 日志不得记录完整 API Key。

## 12. 交给 Nexa 的执行要求

请 Nexa 按照以下要求实施：

```text
读取本接入文档，将现有模型 Provider 配置为 OpenAI Compatible。
Base URL 使用 https://async-api.nexaapp.cn/v1。
API Key 从环境变量读取，禁止写入代码或日志。
启动时调用 GET /v1/models 获取实际模型列表。
文本请求优先使用 POST /v1/chat/completions。
所有需要费用信息的请求加入 include_billing: true。
非流式读取 usage.billing.total_cost。
流式只在最终 usage 数据块读取 usage.billing.total_cost。
费用以 total_cost 为准，不在 Nexa 侧重新计算。
必须兼容 billing 中可选字段缺失。
```
