import tkinter as tk
from tkinter import ttk, messagebox
import os
import requests

# -------------------------- 中奖规则（含福运奖）--------------------------
def check_win(own_red, own_blue, win_red, win_blue):
    red_hit = len(set(own_red) & set(win_red))
    blue_hit = 1 if own_blue == win_blue else 0

    if red_hit == 6 and blue_hit == 1:
        return "一等奖", 10000000
    elif red_hit == 6 and blue_hit == 0:
        return "二等奖", 5000000
    elif red_hit == 5 and blue_hit == 1:
        return "三等奖", 3000
    elif (red_hit == 5 and blue_hit == 0) or (red_hit == 4 and blue_hit == 1):
        return "四等奖", 200
    elif (red_hit == 4 and blue_hit == 0) or (red_hit == 3 and blue_hit == 1):
        return "五等奖", 10
    elif red_hit <= 2 and blue_hit == 1:
        return "六等奖", 5
    elif red_hit == 3 and blue_hit == 0:
        return "福运奖", 5
    else:
        return "未中奖", 0

# -------------------------- 号码解析 --------------------------
def parse_num_input(text):
    text = text.replace("，", " ").replace("、", " ").replace("\n", " ")
    parts = [p.strip() for p in text.split() if p.strip()]
    nums = []
    for p in parts:
        if p.isdigit():
            nums.append(int(p))
    return nums

# -------------------------- 本地保存/读取 --------------------------
CONFIG_FILE = "lottery_config.txt"

def save_user_numbers():
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            for i in range(5):
                red = entries_red[i].get().strip()
                blue = entries_blue[i].get().strip()
                f.write(f"{red}|{blue}\n")
    except:
        pass

def load_user_numbers():
    if not os.path.exists(CONFIG_FILE):
        return
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
        for i in range(min(5, len(lines))):
            line = lines[i].strip()
            if "|" in line:
                red, blue = line.split("|", 1)
                entries_red[i].delete(0, tk.END)
                entries_red[i].insert(0, red)
                entries_blue[i].delete(0, tk.END)
                entries_blue[i].insert(0, blue)
    except:
        pass

# -------------------------- 获取最近20期开奖 --------------------------
def get_recent_10_draws():
    url = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
    # 这里改成 20 期
    params = {"name": "ssq", "issueCount": "20", "pageNo": "1", "pageSize": "20"}
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        data = resp.json()
        items = data.get("result", [])
        res = []
        for it in items[:20]:
            red = it.get("red", "").split(",")
            blue = it.get("blue", "")
            code = it.get("code", "")
            date = it.get("date", "")
            res.append({
                "label": f"{code}期 {date}",
                "red": " ".join(red),
                "blue": blue
            })
        return res
    except:
        return []

# -------------------------- 下拉选择自动填充 --------------------------
def on_draw_select(event):
    if use_custom_var.get() == 1:
        return
        
    idx = combo_draws.current()
    if idx < 0 or idx >= len(draw_list):
        return
    item = draw_list[idx]
    
    entry_win_red.config(state="normal")
    entry_win_blue.config(state="normal")
    
    entry_win_red.delete(0, tk.END)
    entry_win_red.insert(0, item["red"])
    entry_win_blue.delete(0, tk.END)
    entry_win_blue.insert(0, item["blue"])
    
    entry_win_red.config(state="readonly")
    entry_win_blue.config(state="readonly")

# -------------------------- 切换自定义号码开关 --------------------------
def toggle_custom():
    if use_custom_var.get() == 1:
        entry_win_red.config(state="normal")
        entry_win_blue.config(state="normal")
    else:
        entry_win_red.config(state="readonly")
        entry_win_blue.config(state="readonly")
        on_draw_select(None)

# -------------------------- 核对 --------------------------
def check_all():
    try:
        save_user_numbers()
        win_red = parse_num_input(entry_win_red.get())
        win_blue = parse_num_input(entry_win_blue.get())

        if len(win_red) != 6:
            messagebox.showerror("错误", "开奖红球必须6个！")
            return
        if len(win_blue) != 1:
            messagebox.showerror("错误", "开奖蓝球必须1个！")
            return
        win_blue = win_blue[0]

        user_numbers = []
        for i in range(5):
            r = parse_num_input(entries_red[i].get())
            b = parse_num_input(entries_blue[i].get())
            if len(r) != 6:
                messagebox.showerror("错误", f"第{i+1}组红球必须6个！")
                return
            if len(b) != 1:
                messagebox.showerror("错误", f"第{i+1}组蓝球必须1个！")
                return
            user_numbers.append((r, b[0]))

        result_text = f"🔔 开奖号码：红球 {win_red} | 蓝球 {win_blue}\n\n"
        total = 0
        for idx, (r, b) in enumerate(user_numbers, 1):
            prize, money = check_win(r, b, win_red, win_blue)
            total += money
            result_text += f"第{idx}组：红{r} 蓝{b} → {prize}（+{money}元）\n"
        result_text += f"\n💰 总奖金：{total} 元"

        text_result.delete(1.0, tk.END)
        text_result.insert(tk.END, result_text)
    except Exception as e:
        messagebox.showerror("错误", f"输入错误：{str(e)}")

# -------------------------- GUI 界面 --------------------------
root = tk.Tk()
root.title("双色球核对器（官方20期+自定义号码）")
root.geometry("820x680")

tk.Label(root, text="福彩双色球 5组号码自动核对器", font=("微软雅黑", 16, "bold")).pack(pady=10)

# 开关：使用自定义开奖号码
use_custom_var = tk.IntVar()
chk_custom = tk.Checkbutton(root, text="✅ 启用自定义开奖号码（手动填写）", variable=use_custom_var, command=toggle_custom)
chk_custom.pack(padx=20, anchor="w")

# 1. 最近20期下拉框
frame_draws = ttk.LabelFrame(root, text="选择最近20期官方开奖")
frame_draws.pack(padx=20, fill="x", pady=5)
tk.Label(frame_draws, text="开奖期：").grid(row=0, column=0, padx=5)
combo_draws = ttk.Combobox(frame_draws, width=40, state="readonly")
combo_draws.grid(row=0, column=1, padx=5)
combo_draws.bind("<<ComboboxSelected>>", on_draw_select)

# 2. 开奖号码输入框
frame_win = ttk.LabelFrame(root, text="开奖号码")
frame_win.pack(padx=20, fill="x", pady=5)
tk.Label(frame_win, text="红球：").grid(row=0, column=0, padx=5)
entry_win_red = ttk.Entry(frame_win, width=30)
entry_win_red.grid(row=0, column=1, padx=5)

tk.Label(frame_win, text="蓝球：").grid(row=0, column=2, padx=5)
entry_win_blue = ttk.Entry(frame_win, width=10)
entry_win_blue.grid(row=0, column=3, padx=5)

# 加载官方开奖
draw_list = get_recent_10_draws()
if draw_list:
    combo_draws["values"] = [x["label"] for x in draw_list]
    combo_draws.current(0)
    on_draw_select(None)
else:
    messagebox.showwarning("提示", "拉取开奖失败，请手动输入")

# 3. 5组号码
frame_user = ttk.LabelFrame(root, text="5组自选号码（自动保存）")
frame_user.pack(padx=20, fill="x", pady=10)
entries_red = []
entries_blue = []
for i in range(5):
    tk.Label(frame_user, text=f"第{i+1}组：").grid(row=i, column=0, padx=5, pady=3)
    r = ttk.Entry(frame_user, width=25)
    r.grid(row=i, column=1, padx=5)
    entries_red.append(r)

    tk.Label(frame_user, text="蓝：").grid(row=i, column=2, padx=5)
    b = ttk.Entry(frame_user, width=8)
    b.grid(row=i, column=3, padx=5)
    entries_blue.append(b)

# 4. 按钮
tk.Button(root, text="✅ 提交核对", font=("微软雅黑",12,"bold"), bg="#28a745", fg="white", command=check_all).pack(pady=8)

# 5. 结果
frame_result = ttk.LabelFrame(root, text="中奖结果")
frame_result.pack(padx=20, fill="both", expand=True, pady=5)
text_result = tk.Text(frame_result, height=14, font=("微软雅黑",11))
text_result.pack(fill="both", expand=True, padx=5, pady=5)

# 加载本地号码
load_user_numbers()

root.mainloop()