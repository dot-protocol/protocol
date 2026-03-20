"""
Experiment 20: Minimum Viable Archive
100 observations sealed as a chained DOT archive.
"""

import sys
import os
import hashlib
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open

OBSERVATIONS = [
    # 1-10: Numbers & Math
    "One plus one is two. Numbers count how many things exist. Zero means nothing is there.",
    "Addition joins numbers. Subtraction removes them. Multiplication repeats. Division splits.",
    "A circle's distance around equals its width times 3.14159. This number never ends.",
    "Fractions show parts of a whole. Half a pie is one divided by two, written 1/2.",
    "Negative numbers go below zero. Cold weather, debt, and depth use negative numbers.",
    "Infinity is not a number. It means without end. You cannot reach it by counting.",
    "Prime numbers divide only by one and themselves: 2, 3, 5, 7, 11, 13...",
    "Area measures flat space. Volume measures space inside a shape in three directions.",
    "Probability tells how likely something is. Fifty percent means equal chance either way.",
    "Patterns in numbers reveal hidden truths. Mathematics is the language of the universe.",
    # 11-20: The Sky & Universe
    "The Sun is a star. It is 150 million kilometers away. Light takes 8 minutes to reach us.",
    "Earth orbits the Sun once every 365 days. This is one year. The Moon orbits Earth in 27 days.",
    "Stars are so far away that their light takes years to reach us. Some stars we see are already dead.",
    "Our galaxy is called the Milky Way. It contains 200 billion stars. Ours is just one.",
    "The universe began 13.8 billion years ago. Everything expanded from a single point.",
    "Black holes are regions where gravity is so strong that nothing escapes, not even light.",
    "Gravity pulls everything together. It holds planets in orbit and makes apples fall.",
    "Water exists on other moons in our solar system. Life may exist there too.",
    "The night sky you see is a time machine. Each star shows the past, not the present.",
    "Humans have walked on the Moon. We have sent machines beyond our solar system.",
    # 21-30: Your Body
    "Your heart beats 100,000 times a day. It pumps blood to every cell in your body.",
    "Your brain has 86 billion neurons. They communicate through electrical and chemical signals.",
    "DNA is the instruction manual inside every cell. It determines how you are built.",
    "You breathe oxygen. Plants breathe carbon dioxide. Together you keep each other alive.",
    "Sleep is not wasted time. Your brain organizes memories and your body repairs itself while you sleep.",
    "Hunger is your body asking for fuel. Thirst is your body asking for water. Listen to both.",
    "Pain is a signal, not a punishment. It tells you something needs attention.",
    "Exercise makes your heart stronger and your mind sharper. Movement is medicine.",
    "Your gut contains trillions of bacteria that help you digest food and affect your mood.",
    "You are made of atoms that were forged in stars. You are literally made of stardust.",
    # 31-40: History
    "Humans have lived on Earth for 300,000 years. We started in Africa.",
    "Agriculture began 10,000 years ago. Growing food let people stay in one place and build cities.",
    "Writing was invented 5,000 years ago. Before that, all knowledge was spoken or memorized.",
    "The printing press let books spread to everyone, not just the rich. Ideas spread faster.",
    "The scientific revolution taught humans to test ideas instead of just believing authority.",
    "Slavery has existed in most societies. The fight to end it is ongoing.",
    "Every empire in history has ended. Nothing powerful lasts forever without renewal.",
    "Women have fought for equal rights in every era. The struggle continues.",
    "Technology does not make people kinder. Character determines how tools are used.",
    "The greatest protection against repeating history's worst is remembering it honestly.",
    # 41-50: How to Think
    "Ask: is this true? Who said it? What do they want? Look for evidence before believing.",
    "Correlation is not causation. Two things happening together does not mean one caused the other.",
    "Your brain is built to see patterns even when none exist. Check your assumptions.",
    "The simplest explanation that fits the facts is usually correct. Add complexity only when needed.",
    "Changing your mind when evidence requires it is strength, not weakness.",
    "Most people believe they are rational but act on emotion. Know which you are doing.",
    "A question asked well is already half answered. Learn to ask precisely.",
    "Experts know their field but not all fields. Check who is speaking about what.",
    "Strong feelings make things feel more true than they are. Slow down before deciding.",
    "Teach what you know to someone else. If you cannot explain it simply, you do not know it.",
    # 51-60: Money & Business
    "Money is trust made solid. It lets strangers trade with each other across time and distance.",
    "Spend less than you earn. Save the difference. This is the foundation of financial health.",
    "Compound interest means your savings earn interest on their interest. Time makes it powerful.",
    "Debt borrowed for things that grow your income can be useful. Debt for consumption is a trap.",
    "A business solves a problem for people who will pay to have it solved.",
    "Risk and return are linked. Higher potential reward comes with higher potential loss.",
    "Diversification means not putting all eggs in one basket. It reduces risk.",
    "Inflation slowly reduces the value of money sitting still. Learn to make money work.",
    "Tax is the price of civilization. Understand what you owe and pay it honestly.",
    "Reputation is your most valuable business asset. It takes years to build and seconds to lose.",
    # 61-70: People & Relationships
    "Treat others as you want to be treated. This is the oldest law found in every culture.",
    "Listen more than you speak. Most problems between people come from not feeling heard.",
    "Conflict is normal. How you handle it determines whether relationships survive.",
    "Loneliness is a health risk as serious as smoking. Invest in real human connection.",
    "Forgiveness is not for the other person. It releases you from carrying the weight.",
    "Children learn what they live. What you model matters more than what you teach.",
    "Kindness is not weakness. Kindness that has strength behind it is the most powerful.",
    "You cannot pour from an empty cup. Taking care of yourself is not selfishness.",
    "Community is survival. No one has ever succeeded entirely alone.",
    "Every person has a story that would make you more compassionate if you knew it.",
    # 71-80: Your Rights
    "You have the right to think what you think. No government can enter your mind.",
    "Freedom of speech means you can say what you believe without being imprisoned for it.",
    "You are innocent until proven guilty. The burden of proof is on those who accuse you.",
    "Privacy is a right. What happens in your home and your mind belongs to you.",
    "Equal protection under law means the rules apply the same to everyone.",
    "You have the right to peaceful assembly. People gathered in agreement have power.",
    "Access to information is a right. Censorship is a warning sign of control.",
    "Rights require defending. Rights not exercised are rights that can be taken away.",
    "Your rights end where they harm another person's rights. That is the balance.",
    "Know your rights. Write them down. Teach them to children.",
    # 81-90: The Future
    "The world you grow up in will change faster than any generation before you.",
    "Climate is changing because of human activity. The choices made now determine what follows.",
    "Artificial intelligence will transform every field. Learn to work with it.",
    "The most valuable skill in a fast-changing world is the ability to learn new skills.",
    "Energy from the Sun and wind is now cheaper than energy from burning things.",
    "Scarcity of clean water will define conflicts in the coming century.",
    "What you build will outlast you. Build things worth outlasting you.",
    "The problems of the future will be solved by people alive today, including you.",
    "Cooperation across borders has solved problems war never could.",
    "Hope is not passive. Hope is the belief that your actions can change what comes next.",
    # 91-100: The DOT itself
    "This message was sealed by mathematics. Only truth can pass through the DOT protocol.",
    "Every DOT is timestamped and signed. The who, when, and what are locked together.",
    "A chain of DOTs is a chain of verified truth. Each link depends on the one before.",
    "Anyone can verify a DOT. No authority required. Mathematics is the judge.",
    "The DOT cannot lie. It can only report what was sealed at that moment.",
    "If a DOT is tampered with, the signature breaks. Tampering is always visible.",
    "One key, one identity. Your Ed25519 seed is your voice in the DOT network.",
    "You can seal any truth. A thought, a measurement, a promise, a memory.",
    "DOTs can be passed by hand, over Bluetooth, by email, or by any means. They survive.",
    "The act of observation leaves its dot. You are reading the proof of that statement.",
]

assert len(OBSERVATIONS) == 100, f"Need 100, got {len(OBSERVATIONS)}"

kp = crypto.generate_keypair(hashlib.sha256(b"faluda-observer").digest())
BASE_TS = 1741564800_000_000

results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(results_dir, exist_ok=True)

# Seal all 100 as a chain
dots = []
prev = None
t0 = time.perf_counter()
for i, obs in enumerate(OBSERVATIONS):
    d = create(
        payload=obs.encode("utf-8"),
        keypair=kp,
        timestamp_us=BASE_TS + i * 1000,
        parent=prev if prev else None,
    )
    dots.append(d)
    prev = d
seal_ms = (time.perf_counter() - t0) * 1000

# Verify all
t0 = time.perf_counter()
for d in dots:
    verify(d)
verify_ms = (time.perf_counter() - t0) * 1000

# Verify chain links
chain_valid = True
for i in range(1, len(dots)):
    r = dot_open(dots[i])
    expected = crypto.dot_hash(dots[i - 1])
    if r.parent_hash != expected:
        chain_valid = False
        break

total_bytes  = sum(len(d) for d in dots)
avg_bytes    = total_bytes / len(dots)
payload_bytes = sum(len(o.encode("utf-8")) for o in OBSERVATIONS)

# Transmission stats
ble_time_s   = total_bytes * 8 / 1_000_000   # 1 Mbps BLE
qr_max_bytes = 2953                           # QR v40 binary

# Save archive
archive_path = os.path.join(results_dir, "minimum_viable_archive.dot")
with open(archive_path, "wb") as f:
    for d in dots:
        f.write(d)

print("=" * 70)
print("  EXPERIMENT 20: MINIMUM VIABLE ARCHIVE (100 OBSERVATIONS)")
print("=" * 70)
print()
print(f"  Observations:        {len(OBSERVATIONS)}")
print(f"  Payload bytes:       {payload_bytes:,}  (raw text)")
print(f"  Total DOT bytes:     {total_bytes:,}  ({total_bytes/1024:.1f} KB)")
print(f"  Avg DOT size:        {avg_bytes:.1f} bytes")
print(f"  DOT overhead:        {total_bytes - payload_bytes:,} bytes ({(total_bytes-payload_bytes)/payload_bytes*100:.1f}%)")
print()
print(f"  Seal time:           {seal_ms:.1f} ms ({seal_ms/len(dots):.3f} ms/DOT)")
print(f"  Verify time:         {verify_ms:.1f} ms ({verify_ms/len(dots):.3f} ms/DOT)")
print(f"  Chain valid:         {chain_valid}")
print()
print(f"  TRANSMISSION:")
print(f"    BLE (1 Mbps):      {ble_time_s:.2f} seconds")
print(f"    QR codes needed:   {-(-total_bytes // qr_max_bytes)} × v40 QR")
print(f"    Email attachment:  trivially small")
print()
print(f"  Saved to: {archive_path}")
print()
all_pass = chain_valid and all(verify(d).verified for d in dots[:5] + dots[-5:])
print("  ✅ EXP-20 PASSED" if all_pass else "  ❌ EXP-20 FAILED")
print("=" * 70)

assert all_pass, "EXP-20 FAILED"
