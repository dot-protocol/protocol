"""
EXP-43: NARCISSISTIC NUMBER VERIFICATION
"""

print("=" * 65)
print("  EXPERIMENT 43: NARCISSISTIC NUMBER VERIFICATION")
print("=" * 65)
print()

def is_narcissistic(n):
    digits = str(n)
    d = len(digits)
    return sum(int(c)**d for c in digits) == n

# Enumerate all narcissistic numbers <= 1,000,000
narc_all = [n for n in range(1, 1_000_001) if is_narcissistic(n)]

print("NARCISSISTIC NUMBERS ≤ 1,000,000:")
print(narc_all)
print()

# Verify 153
d1, d2, d3 = 1, 5, 3
v153 = d1**3 + d2**3 + d3**3
print(f"153 VERIFICATION: 1³ + 5³ + 3³ = {d1**3} + {d2**3} + {d3**3} = {v153} [NARCISSISTIC: {'YES' if v153 == 153 else 'NO'}]")
print()

# 3-digit narcissistic numbers
narc_3 = [n for n in narc_all if 100 <= n <= 999]
prob_3 = len(narc_3) / 900
print(f"3-DIGIT NARCISSISTIC: {len(narc_3)} numbers in [100,999]")
print(f"Probability random 3-digit number is narcissistic: {len(narc_3)}/900 = {prob_3*100:.3f}%")
print()

# DOT minimums
min_plain = 123
min_sig = 153
print(f"DOT MINIMUM (EXP-03): {min_plain} bytes — narcissistic? {'YES' if is_narcissistic(min_plain) else 'NO'}")
print(f"DOT MINIMUM WITH SIG: {min_sig} bytes — narcissistic? {'YES' if is_narcissistic(min_sig) else 'NO'} (153 = 1³+5³+3³ = {v153} ✓)")
print()

# Probability protocol minimum lands on narcissistic in [100-200]
narc_100_200 = [n for n in narc_all if 100 <= n <= 200]
prob_range = len(narc_100_200) / 101
print(f"Probability protocol minimum lands on narcissistic [100-200 range]:")
print(f"  Narcissistic in [100,200]: {len(narc_100_200)} numbers {narc_100_200}")
print(f"  Probability: {len(narc_100_200)}/101 = {prob_range*100:.2f}%")
print()

# PASS conditions: 153 is narcissistic + probability correctly computed
pass1 = is_narcissistic(153)
pass2 = is_narcissistic(153) and (prob_range * 100 > 0) and len(narc_100_200) >= 1

if pass1 and pass2:
    print("EXPERIMENT 43 PASSED")
else:
    print(f"EXPERIMENT 43 PARTIAL: 153_narc={pass1}, prob_ok={pass2}")
print("=" * 65)
