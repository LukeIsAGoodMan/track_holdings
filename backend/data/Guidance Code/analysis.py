
import pandas as pd
import numpy as np

class RhinoAnalysisSystem:
    def __init__(self, symbol, current_price, history_data, estimates, macro_data):
        """
        初始化系统，注入所有底层死数据
        :param history_data: 包含 'date', 'open', 'high', 'low', 'close', 'volume', 'sma' 的 DataFrame [1]
        :param estimates: 包含未来两年 EPS 和 营收预期的字典 [2]
        :param macro_data: 包含 'vix' 和 'treasury_10y' 的字典 [3, 4]
        """
        self.symbol = symbol.upper()
        self.current_price = current_price
        self.df = history_data
        self.estimates = estimates
        self.macro = macro_data
        
        # 提取最新一天的交易数据用于过滤 [1]
        self.today = self.df.iloc
        self.sma_200 = self.today['sma']
        
        # 计算50日均量作为放量/缩量标准 [5]
        self.avg_volume_50 = self.df['volume'].head(50).mean()

    def step1_valuation(self):
        """1. 基本面和前瞻估值：不看过去，只看未来1-2年 [6]"""
        eps_cy = self.estimates['eps_current_year']
        eps_ny = self.estimates['eps_next_year']
        
        # 计算预期增速
        growth = (eps_ny - eps_cy) / eps_cy
        
        # 犀牛哥估值倍数纪律 [6]
        if growth > 0.50:
            pe_low, pe_high = 35, 45
        elif growth > 0.20:
            pe_low, pe_high = 25, 37.5
        elif growth > 0.10:
            pe_low, pe_high = 22.5, 32.5
        else:
            pe_low, pe_high = 15, 25
            
        val_low = eps_ny * pe_low
        val_high = eps_ny * pe_high
        val_mid = (val_low + val_high) / 2
        
        # 估值定调
        if self.current_price < val_low:
            status = "严重低估（跌破防守底线）"
        elif self.current_price > val_high:
            status = "严重高估（透支未来）"
        else:
            status = "估值合理区间"
            
        return {
            "growth": growth, "val_low": val_low, "val_mid": val_mid, 
            "val_high": val_high, "status": status
        }

    def step2_support_resistance(self):
        """2. 强中弱支撑与压力位推演 (Volume Profile) [7, 8]"""
        # 使用近半年(约120个交易日)数据计算筹码密集区
        recent_df = self.df.head(120).copy()
        
        # 价格按 5 美元一个区间(Bin)划分，计算每个区间的累计成交量
        bins = np.arange(recent_df['low'].min() * 0.9, recent_df['high'].max() * 1.1, 5)
        recent_df['price_bin'] = pd.cut(recent_df['close'], bins=bins)
        vol_profile = recent_df.groupby('price_bin')['volume'].sum()
        
        # 找出成交量最大的几个峰值作为强支撑/压力
        top_bins = vol_profile.nlargest(4).index
        
        supports = []
        resistances = []
        for b in top_bins:
            mid_price = b.mid
            if mid_price < self.current_price:
                supports.append(mid_price)
            else:
                resistances.append(mid_price)
                
        strong_support = max(supports) if supports else self.sma_200 * 0.9 
        strong_resistance = min(resistances) if resistances else self.current_price * 1.1
        
        return {
            "strong_support": round(strong_support, 2),
            "strong_resistance": round(strong_resistance, 2),
            "sma_200": round(self.sma_200, 2) # 中等支撑/生死线 [9]
        }

    def step3_macro_volume_radar(self):
        """3. 宏观雷达与成交量检验 [10, 11]"""
        vix = self.macro['vix']
        treasury = self.macro['treasury_10y']
        
        # 宏观预警逻辑 [11]
        macro_alert = []
        if vix >= 22:
            macro_alert.append(f"VIX高达{vix}，大波动系统性风险未解除，多看少动。")
        elif vix <= 18:
            macro_alert.append(f"VIX回落至{vix}，下行风险保护已拆除，环境安全。")
            
        if treasury >= 4.25:
            macro_alert.append(f"10年期美债收益率突破{treasury}%，对科技股DCF估值产生毁灭性压制。")
            
        # 成交量校验逻辑 [10]
        today_vol = self.today['volume']
        if today_vol > self.avg_volume_50 * 1.5:
            vol_status = "极大放量 (巨头资金进场/机构踩踏)"
        elif today_vol < self.avg_volume_50 * 0.8:
            vol_status = "严重缩量 (买盘缺失/空头回补结束)"
        else:
            vol_status = "平量震荡"
            
        return {"macro_alert": macro_alert, "vol_status": vol_status, "is_high_vol": today_vol > self.avg_volume_50}

    def step4_pattern_recognition(self, sr_data, vol_data):
        """4. 形态判断：严格执行“唯收盘价论”与放量校验 [12-14]"""
        close = self.today['close']
        low = self.today['low']
        open_p = self.today['open']
        support = sr_data['strong_support']
        resistance = sr_data['strong_resistance']
        is_high_vol = vol_data['is_high_vol']
        
        patterns = []
        
        # 1. 破位形态判断 (收盘或开盘跌破) [14]
        if close < support or open_p < support:
            patterns.append(f"有效破位：已收盘跌破强支撑 {support}，放弃幻想！")
        # 防骗炮：盘中假摔
        elif low < support and close >= support:
            patterns.append(f"盘中假摔：盘中曾击穿 {support}，但收盘成功站回，防守有效。")
            
        # 2. 止跌形态判断 (靠近均线/支撑 + 放量) [13]
        if close > support and (close - support)/support < 0.05 and is_high_vol:
            patterns.append(f"止跌形态：在关键支撑 {support} 附近放量，说明有大资金接盘，走出了第一条腿。")
            
        # 3. 缩量反弹 (死猫跳) [10]
        if self.df.iloc[15]['close'] < close and not is_high_vol:
            patterns.append("缩量反弹：反弹没有大幅放量，说明空头回补停下来了，买盘缺失，随时可能掉头。")
            
        # 4. 悬空地带 [16]
        if support * 1.05 < close < resistance * 0.95:
            patterns.append("悬空地带：目前价格上下不靠，刮风下雨都不保险。")
            
        return patterns

    def generate_report(self):
        """5. 最终生成犀牛哥风格的解盘剧本"""
        val = self.step1_valuation()
        sr = self.step2_support_resistance()
        mv = self.step3_macro_volume_radar()
        patterns = self.step4_pattern_recognition(sr, mv)
        
        # 组装文案
        report = f"## 【{self.symbol}】 犀牛哥系统量化解盘剧本\n\n"
        
        report += f"### 一、 基本面与前瞻估值（价值之锚）\n"
        report += f"根据未来业绩指引，{self.symbol} 预期EPS增速为 **{val['growth']:.1%}**。依照我们的纪律，给予相应的PE中枢。\n"
        report += f"计算得出前瞻估值区间为：**${val['val_low']:.2f} 到 ${val['val_high']:.2f}**，中位数为 **${val['val_mid']:.2f}**。\n"
        report += f"当前市价 **${self.current_price}**，从基本面上看属于：**{val['status']}**。\n\n"
        
        report += f"### 二、 强中弱支撑与生死线推演\n"
        report += f"- **结构性反转线（强压力）**：**${sr['strong_resistance']}**。必须放量突破这里，才叫反转，否则全以反弹对待。\n"
        report += f"- **生死底线（强支撑）**：**${sr['strong_support']}**。这是过去半年筹码堆积区，绝不能有效跌破。\n"
        report += f"- **中长线多空分水岭**：**200日均线 ${sr['sma_200']}**。\n\n"
        
        report += f"### 三、 宏观雷达与成交量“照妖镜”\n"
        report += f"- **成交量状态**：**{mv['vol_status']}**。\n"
        for alert in mv['macro_alert']:
            report += f"- **宏观警告**：{alert}\n"
        report += "\n"
        
        report += f"### 四、 技术形态严格判定 (唯收盘价论)\n"
        if not patterns:
            report += "- 目前未触发特殊的极端形态，按震荡区间处理。\n"
        for p in patterns:
            report += f"- **{p}**\n"
        report += "\n"
        
        report += f"### 五、 最终操作剧本与风控计划\n"
        report += "结合上述所有硬核数据，制定以下计划：\n"
        
        # 动态套用交易哲学
        if self.current_price < sr['strong_support']:
            report += "> **【挨打立正】** 技术面已有效破位！面临流动性无差别踩踏。此时基本面估值暂时失效，做投资要‘站好挨打’，承认失利，严格执行止损纪律，保护整体账户健康！[17]\n"
        elif "悬空地带" in str(patterns):
            report += "> **【多看少动】** 现价处于支撑与压力中间的悬空地带。大资金在博弈，散户不要在半山腰盲目接飞刀。最高指令：多看少动，耐心等待方向选择！[16, 18]\n"
        elif "止跌形态" in str(patterns):
            report += "> **【左侧防守】** 跌到了关键强支撑且放量，巨头资金入场。可以在此博弈左侧买点。但记住，只走出了第一条腿，必须设立止损。[13]\n"
        
        report += "\n**⚠️ 风控铁律：** 无论你多看好这只股票，单只个股的持仓极限绝对不应超过 **15%**，必须给自己留下容错率。另外，绝不赌财报，不要把投资变成掷硬币！[19, 20]"
        
        return report

# ==========================================
# 使用 FMP 历史数据进行测试运行
# ==========================================

# 1. 构造假数据 (利用提供的资料)
# 微软最新收盘价 395.55, 200日均线在 483 附近 [1]
msft_history = pd.DataFrame([
    {"date": "2026-03-13", "open": 401, "high": 404.8, "low": 394.25, "close": 395.55, "volume": 26848000, "sma": 483.26},
    {"date": "2026-03-12", "open": 404.63, "high": 406.12, "low": 401.71, "close": 401.86, "volume": 27263900, "sma": 483.58},
    # ...(此处省略百天数据，实际应用时传入 FMP EOD full json)
])
for _ in range(118): # mock 补齐 120 天以便算法运行
    msft_history = pd.concat([msft_history, pd.DataFrame([{"open": 420, "high": 430, "low": 410, "close": 420, "volume": 25000000, "sma": 480}])], ignore_index=True)

# EPS预期 (2026与2027财年预期) [21, 22]
msft_estimates = {
    "eps_current_year": 16.48, # 2026
    "eps_next_year": 19.01     # 2027
}

# 宏观环境 [3, 4]
macro_env = {
    "vix": 27.19,
    "treasury_10y": 4.28
}

# 2. 运行系统
rhino_system = RhinoAnalysisSystem(
    symbol="MSFT",
    current_price=395.55,
    history_data=msft_history,
    estimates=msft_estimates,
    macro_data=macro_env
)

print(rhino_system.generate_report())