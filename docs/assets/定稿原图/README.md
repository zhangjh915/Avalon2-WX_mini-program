# 定稿原图

生成时的原始尺寸 **1728×2304**，未压缩。这里只放**最终选中**的，
抽卡时没被选中的废片留在本机的 `docs/assets/generated/`（已 gitignore，1108 张 1.1G）。

为什么单独放一份而不是复用 `generated/`：`generated/` 整个目录被 gitignore 了，
里面绝大多数是一次性的抽卡对比产物；而定稿原图是花钱买来的成果，
抽卡有随机性，同样的提示词跑不出同一张脸，丢了就真找不回来。

小程序实际用的是压缩版，在 `miniprogram/assets/`（按各资产的 @3x 物理像素缩过）。
重新导出：`python3 scripts/export-assets.py`。

对应的提示词和选择记录在 `docs/assets/prompts/`。
