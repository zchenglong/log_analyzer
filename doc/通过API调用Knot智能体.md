# 通过API调用智能体

> 来源：https://iwiki.woa.com/p/4016457374

通过API调用智能体，适合脚本、后台对接智能体的场景。

## 1.AG-UI 协议（推荐）

**样例代码【对话】**

```python
import json
import requests

api_url = "智能体的AGUI协议 API端点" ## "http://knot.woa.com/apigw/api/v1/agents/agui/{agent_id}"

chat_body = {
    "input": {
        "message": "这里是你的提问",
        "conversation_id": "",
        "model": "deepseek-v3.1", # 模型名称，可选deepseek-v3.1, deepseek-v3.2, glm-4.7, claude-4.6-sonnet, hunyuan-2.0-thinking, hunyuan-2.0-instruct
      	"stream": True, # true/false, 非流式请传 false
      	"enable_web_search": False, # 是否开启联网搜索
      	"chat_extra": {
          	"agent_client_uuid": "", 	# 工作区的id, 创建完之后可以在https://knot.woa.com/agent/workspace 页面中获取. (工作区相关信息详见https://iwiki.woa.com/p/4016884620)
        	"attached_images": ["图片的 cos 地址"],
          	"extra_headers": {		# 额外的请求头，在调用 mcp 工具时会透传，map[string]string，
            	
            }
        },
      	"temperature": 0.5 ## 如果指定了，则以这个为准，否则以智能体配置为准，[0,1]
    }
}

headers = {
	"x-knot-api-token": "用户的个人/团队 token" ## 通过 https://knot.woa.com/settings/token 或者 https://knot.woa.com/settings/token?type=team 申请
  	"x-knot-api-user": "当前真实的用户（企微英文名）" ## 当使用团队 token 时, 指定用户身份的专用 header, 当使用场景获取不到真实用户时，请传递团队 token 的账号名称，如果您是存量用户，想切换至团队 token 并已在 x-username 中指定用户身份，该字段可不传
}

response = requests.post(api_url, json=chat_body, headers=headers, stream=True)
conversation_id = ""
for chunk in response.iter_lines():
    if not chunk:
        continue
    chunk_str = chunk.decode("utf-8").lstrip("data:").strip()  # 处理数据块格式
    if chunk_str == "[DONE]":
        break
    msg = json.loads(chunk_str)
    if "type" not in msg:
      	continue
    
    msg_type = msg["type"]
    conversation_id = msg["rawEvent"]["conversation_id"]
    
    if msg_type == "TEXT_MESSAGE_CONTENT":
        print(msg["rawEvent"]["content"], end="")
    

print("")
print("conversation_id:", conversation_id) # 这个conversation_id设置到chat_body中的input.conversation_id，则会继承前面会话的历史记录
```

### 1.2 agui 事件

事件枚举参考：https://github.com/ag-ui-protocol/ag-ui

#### 1.2.1 消息调用相关事件

| 事件 | rawEvent特殊字段 | rawEvent示例 |
| --- | --- | --- |
| TextMessageStart | | `{"message_id": "01995161aca6777e92d99322aaa32ddd", "conversation_id": "019951616426777e92d98cf511f7db4c"}` |
| TextMessageContent | content: 消息拼接的内容 | `{"message_id": "...", "conversation_id": "...", "content": "按照您的要求分三"}` |
| TextMessageEnd | 无 | `{"message_id": "...", "conversation_id": "..."}` |

#### 1.2.2 思考消息调用相关事件

| 事件 | rawEvent特殊字段 | rawEvent示例 |
| --- | --- | --- |
| ThinkingTextMessageStart | | `{"message_id": "...", "conversation_id": "..."}` |
| ThinkingTextMessageContent | content: 消息拼接的内容 | `{"message_id": "...", "conversation_id": "...", "content": "按照您的要求分三"}` |
| ThinkingTextMessageEnd | 无 | `{"message_id": "...", "conversation_id": "..."}` |

#### 1.2.3 工具调用相关事件

ToolCallStart / ToolCallArgs / ToolCallEnd / ToolCallResult

### 1.3 状态同步

当遇到会阻塞会话进行的报错，事件发送后中断整个会话。如 con 模型调用失败。

| 事件 | rawEvent特殊字段 | rawEvent示例 |
| --- | --- | --- |
| RunError | tip_option: TipOption | `{"message_id": "...", "conversation_id": "...", "tip_option": {"type": "text", "level": "error", "content": "Request processing error: ..."}}` |

### 1.4 生命周期细化

涉及事件：

| 事件 | 说明 |
| --- | --- |
| StepFinished | agent 执行步骤的结束事件 |
| StepStarted | agent 执行步骤的开始事件 |

生命周期事件 rawEvent 通用字段：

| 字段名 | 说明 |
| --- | --- |
| step_name | call_llm、execute_tool 步骤类型 |

生命周期事件 rawEvent 特殊字段：

| 事件 | rawEvent特殊字段 | rawEvent示例 |
| --- | --- | --- |
| StepFinished | step_name、token_usage（可选）| `{"step_name": "call_llm", "token_usage": {"completion_tokens": 320, "prompt_tokens": 12365, ...}}` |
| StepStarted | step_name | `{"step_name": "call_llm"}` |

TokenUsage 结构：

```json
{
  "completion_tokens": 303,
  "prompt_tokens": 22184,
  "total_tokens": 22487,
  "completion_tokens_details": {
    "accepted_prediction_tokens": null,
    "audio_tokens": null,
    "reasoning_tokens": 0,
    "rejected_prediction_tokens": null
  },
  "prompt_tokens_details": {
    "audio_tokens": null,
    "cached_tokens": null,
    "cache_write_tokens": 22180
  }
}
```

### 1.5 一些使用参考

#### 1.5.1 只需要最后的回答结果

```python
result = []
for chunk in response.iter_lines():
    if not chunk:
        continue
    chunk_str = chunk.decode("utf-8").lstrip("data:").strip()  # 处理数据块格式
    if chunk_str == "[DONE]":
        break
    msg = json.loads(chunk_str)
    if "type" not in msg:
      	continue
    
    msg_type = msg["type"]
    if msg_type == "TEXT_MESSAGE_START":
      result = []
    
    if msg_type == "TEXT_MESSAGE_CONTENT":
        result.append(msg["rawEvent"]["content"])
print("".join(result))
```

---

## 2. XML 协议

**样例代码【对话】**

```python
import json
import requests

api_url = "智能体的API端点"

chat_body = {
    "input": {
        "message": "这里是你的提问",
        "conversation_id": "",
        "model": "deepseek-v3", # 模型名称，可选deepseek-r1-0528和deepseek-v3,kimi-k2-instruct,glm-4.6
      	"stream": True, # true/false, 非流式请传 false
      	"enable_web_search": False  # 是否开启联网搜索
    }
}

headers = {
    "x-knot-token": "智能体的API 密钥",
    "X-Username": "用户名"
}
'''
首次对话的时候，请将chat_body.input.conversation_id设置为空字符串，这将生成一个新的会话，
在会话的响应数据中会返回这个新建会话的会话ID。
后续会话如果要接上前面的对话历史，请将首轮对话返回的会话ID设置到chat_body的input.conversation_id。
'''
response = requests.post(api_url, json=chat_body, headers=headers, stream=True)
conversation_id = ""
for chunk in response.iter_lines():
    if not chunk:
        continue
    chunk_str = chunk.decode("utf-8").lstrip("data: ").strip()  # 处理数据块格式
    if chunk_str == "[DONE]":
        break
    msg = json.loads(chunk_str)
    if msg["conversation_id"]:
        conversation_id = msg["conversation_id"]
    print(msg["choices"][0]["delta"]["content"], end="")

print("")
print("conversation_id:", conversation_id)
```

### 2.1 流式返回格式

```json
{
    "id": "",
    "object": "",
    "created": 0,
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "",
                "content": "非流式返回内容"
            },
            "finish_reason": "string",
            "delta": {
                "role": "",
                "content": "流式返回内容，流式结果中包含一些特定标签格式，详情下一节内容"
            }
        }
    ],
    "usage": {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "completion_tokens_details": {
            "reasoning_tokens": 0,
            "accepted_prediction_tokens": 0,
            "rejected_prediction_tokens": 0
        }
    },
    "message_id": "string",
    "conversation_id": "string",
    "app_version": "string"
}
```

### 2.2 流式 content 内容说明

#### 2.2.1 正文内容的 thinking

```
<thinking>xxxx</thinking>
如果有模型的思考过程，则以 thinking 标签包裹返回给前端
```

#### 2.2.2 mcp 工具格式说明

```xml
<!-- mcp工具返回格式 -->
<gongfeng-tool>
    <!-- 必填：type枚举包括sys/mcp区分是系统内置工具调用还是mcp工具调用 -->
    <type>mcp</type>
    <server_name>read_file</server_name>
    <!-- 必填：工具调用名称 -->
    <name>read_file</name>
    <!-- 选填：工具调用输出结果，格式为转义后的json字符串 -->
    <tool_result></tool_result>
    <!-- 选填：工具调用参数，格式为转义后的json字符串 -->
    <tool_params></tool_params>
    <!-- 选填：某些工具特定返回的一些标签 -->
    <argument>...</argument>
    <mcp_type>client/server</mcp_type>
    <!-- 选填：展示别名 -->
    <display_name></display_name>
</gongfeng-tool>
```

#### 2.2.3 执行过程中有错误信息返回格式

```xml
<!-- 其他错误信息，非工具执行的错误信息展示，遇到此标签，主要展示内容中的error和warning信息给用户 -->
<agent-status>
    <code>-1</code>
    <error>错误信息</error>
    <warning>警告信息</warning>
</agent-status>
```

---

## 3. 拉取对话历史

支持分页查询智能体对话历史。

> 注：需要使用用户个人 token 进行调用，需拥有智能体的管理权限。token 申请地址：https://knot.woa.com/settings/token

参数说明：
- `conversation_id`：非必填，指定即查询对应会话的对话历史
- `user`：非必填，指定即查询对应用户的对话历史

```shell
curl -v -XPOST "https://knot.woa.com/apigw/api/v1/agents/{agentID}/chat_history" \
  -H "x-knot-api-token: xxx" \
  -H "Content-Type:application/json" \
  -d '{
    "conversation_id": "{conversationID}",
    "user": "{user}",
    "page": 1,
    "per_page": 50,
    "start_time": "2025-12-26 00:00:00",
    "end_time": "2025-12-26 23:59:59"
  }'
```

---

## 4. 调用报错 FAQ

| 错误信息 | 原因 |
| --- | --- |
| `invalid username: xx, username in header is empty` | 在 header 中没有填充 X-Username |
| `request body unmarshal err` | 输入的参数类型不合法 |
| `user message can not be empty` | 没有输入问题 |
| `you have no permission to access agent` | 没有智能体的使用权限，可联系智能体管理员添加 |
| `kont agent token is invalid` | knot-token 不合法 |
