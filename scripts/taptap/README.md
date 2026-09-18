# TapTap 后台自动化脚本(CDP)

对已登录的调试 Chrome(`--remote-debugging-port=49351`)直接下发 CDP 指令,
用于版本发布页(/store/update)的素材上传自动化。

所有脚本均为零依赖,需加 `--experimental-websocket` 运行:

```bash
node --experimental-websocket scripts/taptap/list-triggers.mjs
```

## 前置条件

1. 调试 Chrome 运行中,且已登录 TapTap 开发者后台
2. 已打开目标游戏的「版本发布」页(`*/store/update`)

## 典型流程:上传/替换一个素材槽

```bash
# 1. 列出当前素材槽的上传 trigger(0/1/2 = 图标/16:9/1:1,已填充的槽不再出现)
node --experimental-websocket scripts/taptap/list-triggers.mjs

# 2. 点击目标 trigger,弹出「素材库」弹窗
node --experimental-websocket scripts/taptap/click-trigger.mjs 0

# 3. 点击弹窗内「上传素材」按钮,触发文件选择框
node --experimental-websocket scripts/taptap/click-modal-button.mjs "上传素材" 0

# 4. 文件选择框由 playwright-cli 会话拦截并挂起,用它塞入文件
playwright-cli attach --cdp=http://127.0.0.1:49351
playwright-cli upload <本地文件>

# 5. 上传成功后若新图未被自动勾选,手动勾选第 0 项(库内按最新排序)
node --experimental-websocket scripts/taptap/check-library-item.mjs 0

# 6. 点击「确认选择」(内部轮询"已选 N"出现后再点,失败自动换坐标重试)
node --experimental-websocket scripts/taptap/confirm-material.mjs

# 7. 若截图/页面出现冻结假象,强制刷新合成帧
node --experimental-websocket scripts/taptap/unfreeze.mjs [输出路径]
```

## 踩坑记录

- **坐标体系**:`Input.dispatchMouseEvent` 用视口坐标,必须基于
  `getBoundingClientRect` 现取现用;`DOM.getBoxModel` 是文档坐标,滚动后会点空。
- **弹窗布局漂移**:上传完成后右侧预览面板才出现,「确认选择」按钮位置会变,
  必须在点击前一刻重新取坐标(confirm-material.mjs 已内置轮询+重试)。
- **素材库会记住上一次的勾选**:换槽位上传前先检查勾选状态,避免把上一张图
  绑到当前槽(尺寸不符会被静默拒绝,槽位看起来什么都没发生)。
- **Playwright 点击全超时**:本页面存在持续动画,Playwright 的 stability 检查
  永远不通过,所以交互一律走 CDP `Input.dispatchMouseEvent` 真鼠标事件。
- **文件选择框的拦截由 playwright-cli 会话完成**(其 `upload` 命令处理挂起的
  chooser);裸 CDP 的 `Page.setInterceptFileChooserDialog` 与之会互相抢,
  二者只留一个。
- **页面素材上传 API**:`POST /api/image/v1/upload`(multipart),但上传成功
  ≠ 绑定到槽位,绑定以「素材库勾选 + 确认选择」为准。
