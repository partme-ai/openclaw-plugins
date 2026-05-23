# wecom-kf-send-media

## 功能
通过客服消息接口向用户发送图片、视频、语音、文件。

## 指令格式
```
MEDIA: /文件的绝对路径
```

## 文件类型与限制
| 类型 | 扩展名 | 大小限制 | MIME 类型 |
|------|--------|---------|-----------|
| 图片 | jpg, jpeg, png, gif | 10MB | image/jpeg, image/png |
| 视频 | mp4, mov | 10MB | video/mp4 |
| 语音 | amr | 2MB | voice/amr |
| 文件 | pdf, docx, xlsx, etc. | 20MB | application/* |

## 智能降级策略
- 图片 >10MB → 转为文件发送
- 视频 >10MB → 转为文件发送
- 语音非 AMR 格式 → 转为文件发送
- 语音 >2MB → 转为文件发送
- 文件 >20MB → 提示用户无法发送

## 注意事项
- MEDIA: 必须在行首，后跟文件的绝对路径
- 路径中有空格时请用反引号包裹
- 每个文件单独一行 MEDIA: 指令
- 文件优先存放到 ~/.openclaw 目录
