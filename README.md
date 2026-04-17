# BiliTogether

一个基于 `Chrome Manifest V3` 的双人一起看 B 站插件原型，特点：

- 纯前端，无 Supabase、无房间服务
- 通过房间号建立连接
- 基于 `WebRTC DataChannel` 同步播放控制和聊天
- 支持播放、暂停、拖动、倍速、切换视频
- 双方都可以抢控制，按最后一次操作生效
- 长连接运行在 `offscreen document`，避免被 service worker 生命周期打断

## 本地加载

1. 打开 `chrome://extensions/`
2. 启用“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择当前仓库目录 `e:\code\BiliTogether`

## 使用方式

1. 房主点击“创建房间”，会自动复制房间号
2. 加入方贴入房间号，点击“加入房间”
3. 双方打开 B 站视频页后即可同步播放和聊天

## 开发验证

- 语法检查：`node --check src/background/background.js`
- 单元测试：`node --test tests/*.test.js`
- 人工联调：使用两个独立 Chromium profile 加载扩展后分别建房 / 加入，验证播放、暂停、拖动、倍速、切换视频、刷新页面和断线提示

## 当前限制

- 只支持 `Chromium` 浏览器
- 只支持 `2 人`
- 不支持自动重连，断开后需要重新配对
- 使用公共 `STUN`，某些网络环境可能无法成功建立 P2P 连接
- 这是首版原型，未包含自动化测试和发布配置
