# 交易天才

一个给家人看的简易持仓收益网页。页面按手机截图场景设计，服务端自动读取公开 A 股行情并计算累计收益、收益率和组合汇总。

## 当前持仓

默认持仓写在 `data/holdings.json`，线上没有设置 `HOLDINGS_JSON` 时会读取这份配置。

| 股票 | 股数 | 成本价 |
| --- | ---: | ---: |
| 688146.SH | 300 | 390 |
| 688530.SH | 200 | 85 |

## 本地运行

```bash
npm install
npm start
```

打开 `http://localhost:3000`。

## Render

如果作为独立仓库部署，Render 可使用：

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

仓库内也包含 `render.yaml`，可以直接作为 Blueprint 导入。

可选环境变量：

- `REFRESH_SECONDS`: 页面自动刷新秒数，默认 `30`
- `QUOTE_CACHE_MS`: 服务端行情缓存毫秒数，默认 `15000`
- `HOLDINGS_JSON`: 覆盖默认持仓配置，例如 `[{"code":"688146","market":"SH","shares":300,"costPrice":390}]`
