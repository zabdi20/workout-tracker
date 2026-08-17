# Hypertrophy 4-Day Upper/Lower Template — Implementation Spec

## Overview
- **Goal:** Hypertrophy, upper-body growth prioritized
- **Structure:** Upper/Lower x2 (Upper A, Lower A, Upper B, Lower B)
- **Days per week:** 4
- **Muscle group frequency:** ~2x/week per major muscle group
- **Equipment:** home gym — dumbbells, bench, smith machine, pull-up bar, leg extension machine, leg curl machine, lat pulldown machine, cable machine, chest press machine
- **Context baked into the design:** user also plays basketball and soccer regularly, so lower-body hypertrophy volume was trimmed and a power/agility/stability block was added to each lower day instead — this preserves upper-body recovery capacity (the growth priority) while still training explosiveness and landing/change-of-direction control for sport.
- **Progression model:** double progression, effort regulated by RIR (reps in reserve), not fixed percentages.

---

## Day 1 — Upper A (Chest & Back Emphasis)
| # | Exercise | Sets x Reps | Rest | Notes |
|---|----------|-------------|------|-------|
| 1 | Smith Machine Bench Press | 4 x 6-8 | 2-3 min | Main chest driver, heavier/lower reps |
| 2 | Lat Pulldown | 4 x 8-10 | 90 sec | Full stretch at top |
| 3 | Chest Press Machine | 3 x 10-12 | 90 sec | Different angle than bench |
| 4 | Seated Cable Row | 3 x 10-12 | 90 sec | Squeeze shoulder blades |
| 5 | DB Lateral Raise | 3 x 12-15 | 60 sec | Strict, no swinging |
| 6 | Cable Tricep Pushdown | 3 x 10-12 | 60 sec | |
| 7 | DB Bicep Curl | 3 x 10-12 | 60 sec | |

## Day 2 — Lower A (Power & Stability, then Quads)
**Block 1 — Power/Agility (do first, while fresh)**
| # | Exercise | Sets x Reps | Rest | Notes |
|---|----------|-------------|------|-------|
| 1 | Lateral Bounds (skater jumps) | 3 x 6/side | 60 sec | Stick landing before next rep |
| 2 | Explosive Box Step-Up | 3 x 6/leg | 90 sec | Bench as box; drive up fast |
| 3 | Broad Jump | 3 x 5 | 90 sec | Pause 2 sec on landing; low-noise swap = squat jump in place |

**Block 2 — Strength (trimmed to protect upper-body recovery)**
| # | Exercise | Sets x Reps | Rest | Notes |
|---|----------|-------------|------|-------|
| 4 | Smith Machine Squat | 3 x 6-8 | 2-3 min | |
| 5 | Leg Extension | 2 x 12-15 | 60 sec | |
| 6 | Single-Leg DB RDL | 2 x 8/leg | 60 sec | Balance + hamstring stability |
| 7 | Standing Calf Raise | 3 x 12-15 | 45 sec | |

Sport-day rule: if a game is within 24 hrs, keep squat weight moderate, stop 1-2 reps shy of failure.

## Day 3 — Upper B (Shoulders & Arms Emphasis)
| # | Exercise | Sets x Reps | Rest | Notes |
|---|----------|-------------|------|-------|
| 1 | Pull-Ups | 4 x 6-10 | 2 min | Band-assisted if needed |
| 2 | DB Shoulder Press | 4 x 8-10 | 90 sec | |
| 3 | Incline DB Press | 3 x 10-12 | 90 sec | Upper chest |
| 4 | Cable Face Pull | 3 x 12-15 | 60 sec | Rear delts / upper back health |
| 5 | Cable Lateral Raise | 3 x 12-15 | 60 sec | |
| 6 | EZ/Cable Curl | 3 x 10-12 | 60 sec | |
| 7 | Overhead DB Tricep Extension | 3 x 10-12 | 60 sec | |

## Day 4 — Lower B (Agility & Core, then Hamstrings/Glutes)
**Block 1 — Agility/Stability (do first, while fresh)**
| # | Exercise | Sets x Reps | Rest | Notes |
|---|----------|-------------|------|-------|
| 1 | Lateral Shuffle | 4 x 20 sec | 45 sec | Change direction on a cue/count |
| 2 | Single-Leg Hop & Stick | 3 x 5/leg | 60 sec | Land soft, hold 2 sec |
| 3 | Cable Pallof Press | 3 x 10/side | 45 sec | Anti-rotation core, quiet/low-impact |

**Block 2 — Strength (trimmed)**
| # | Exercise | Sets x Reps | Rest | Notes |
|---|----------|-------------|------|-------|
| 4 | Smith Machine RDL | 3 x 8-10 | 2 min | |
| 5 | DB Bulgarian Split Squat | 2 x 10/leg | 90 sec | |
| 6 | Leg Curl | 2 x 10-12 | 90 sec | |
| 7 | Seated Calf Raise | 2 x 12-15 | 45 sec | |

Sport-day rule: if a game is within 24 hrs, cap RDL at 2 working sets, stay a couple reps from failure.

---

## Weekly Direct Set Volume (target ranges for reference: ~10-16 sets/wk per muscle at this level)
| Muscle Group | Sets/Week |
|---|---|
| Back | 14 |
| Chest | 10 |
| Shoulders | 10 |
| Hamstrings | 7 |
| Quads | 7 |
| Biceps | 6 |
| Triceps | 6 |
| Calves | 5 |

Lower-body numbers sit below the typical hypertrophy range on purpose — deprioritized in favor of upper-body volume, with the power/agility block covering athletic quality instead of added fatigue.

## Progression Rules
- **Model:** double progression per exercise. Stay at a given weight until every working set hits the top of its rep range at the target RIR, then increase weight and drop back to the bottom of the range.
- **Effort target:** RIR 1-3 on most sets; only the last set of an exercise should approach RIR 0-1.
- **Weight jump size:** +2.5-5 lb for upper-body presses/rows; +5-10 lb for squat/RDL; smallest available increment for dumbbells/machines (add a rep instead if the jump is too large).
- **New exercise/weight:** start conservative — a load you're confident you could exceed the prescribed reps with — then calibrate RIR from there.
- **Deload trigger:** if sets are grinding or RIR is stuck at 0 for two sessions in a row (not one bad day), cut volume ~40% for a week at moderate weight, then resume.
- **Plyo/agility exercises are not RIR-based.** Stop the set when movement quality drops, regardless of rep count.

---

## JSON Data (for direct ingestion)

```json
{
  "template_name": "Hypertrophy — 4-Day Upper/Lower (Upper-Body Priority)",
  "goal": "hypertrophy",
  "priority": "upper_body",
  "days_per_week": 4,
  "equipment": ["dumbbells", "bench", "smith_machine", "pull_up_bar", "leg_extension_machine", "leg_curl_machine", "lat_pulldown_machine", "cable_machine", "chest_press_machine"],
  "progression": {
    "model": "double_progression",
    "effort_metric": "RIR",
    "default_rir_range": [1, 3],
    "last_set_rir_range": [0, 1],
    "weight_increment": {
      "upper_compound": "2.5-5 lb",
      "lower_compound": "5-10 lb",
      "dumbbell_or_machine": "smallest available increment"
    },
    "deload_trigger": "RIR stuck at 0 for 2 consecutive sessions",
    "deload_action": "reduce volume ~40% for 1 week at moderate weight"
  },
  "days": [
    {
      "day_id": "upper_a",
      "label": "Upper A",
      "focus": "Chest & Back Emphasis",
      "blocks": [
        {
          "block_name": "Strength",
          "exercises": [
            {"name": "Smith Machine Bench Press", "sets": 4, "rep_range": "6-8", "rest_sec": 150, "muscle_groups": ["chest", "triceps", "shoulders"], "notes": "Main chest driver"},
            {"name": "Lat Pulldown", "sets": 4, "rep_range": "8-10", "rest_sec": 90, "muscle_groups": ["back", "biceps"]},
            {"name": "Chest Press Machine", "sets": 3, "rep_range": "10-12", "rest_sec": 90, "muscle_groups": ["chest", "triceps"]},
            {"name": "Seated Cable Row", "sets": 3, "rep_range": "10-12", "rest_sec": 90, "muscle_groups": ["back", "biceps"]},
            {"name": "DB Lateral Raise", "sets": 3, "rep_range": "12-15", "rest_sec": 60, "muscle_groups": ["shoulders"]},
            {"name": "Cable Tricep Pushdown", "sets": 3, "rep_range": "10-12", "rest_sec": 60, "muscle_groups": ["triceps"]},
            {"name": "DB Bicep Curl", "sets": 3, "rep_range": "10-12", "rest_sec": 60, "muscle_groups": ["biceps"]}
          ]
        }
      ]
    },
    {
      "day_id": "lower_a",
      "label": "Lower A",
      "focus": "Power & Stability, then Quads",
      "blocks": [
        {
          "block_name": "Power/Agility",
          "order_note": "perform first, while fresh",
          "effort_metric": "movement_quality",
          "exercises": [
            {"name": "Lateral Bounds (skater jumps)", "sets": 3, "rep_range": "6/side", "rest_sec": 60, "muscle_groups": ["quads", "glutes", "stability"]},
            {"name": "Explosive Box Step-Up", "sets": 3, "rep_range": "6/leg", "rest_sec": 90, "muscle_groups": ["quads", "glutes"], "notes": "Use bench as box"},
            {"name": "Broad Jump", "sets": 3, "rep_range": "5", "rest_sec": 90, "muscle_groups": ["quads", "glutes", "power"], "low_impact_alternative": "Squat jump in place"}
          ]
        },
        {
          "block_name": "Strength",
          "exercises": [
            {"name": "Smith Machine Squat", "sets": 3, "rep_range": "6-8", "rest_sec": 165, "muscle_groups": ["quads", "glutes"]},
            {"name": "Leg Extension", "sets": 2, "rep_range": "12-15", "rest_sec": 60, "muscle_groups": ["quads"]},
            {"name": "Single-Leg DB RDL", "sets": 2, "rep_range": "8/leg", "rest_sec": 60, "muscle_groups": ["hamstrings", "glutes", "stability"]},
            {"name": "Standing Calf Raise", "sets": 3, "rep_range": "12-15", "rest_sec": 45, "muscle_groups": ["calves"]}
          ]
        }
      ],
      "conditional_notes": ["If a game is within 24 hrs: keep squat weight moderate, stop 1-2 reps shy of failure"]
    },
    {
      "day_id": "upper_b",
      "label": "Upper B",
      "focus": "Shoulders & Arms Emphasis",
      "blocks": [
        {
          "block_name": "Strength",
          "exercises": [
            {"name": "Pull-Ups", "sets": 4, "rep_range": "6-10", "rest_sec": 120, "muscle_groups": ["back", "biceps"], "notes": "Band-assisted if needed"},
            {"name": "DB Shoulder Press", "sets": 4, "rep_range": "8-10", "rest_sec": 90, "muscle_groups": ["shoulders", "triceps"]},
            {"name": "Incline DB Press", "sets": 3, "rep_range": "10-12", "rest_sec": 90, "muscle_groups": ["chest", "shoulders"]},
            {"name": "Cable Face Pull", "sets": 3, "rep_range": "12-15", "rest_sec": 60, "muscle_groups": ["rear_delts", "upper_back"]},
            {"name": "Cable Lateral Raise", "sets": 3, "rep_range": "12-15", "rest_sec": 60, "muscle_groups": ["shoulders"]},
            {"name": "EZ/Cable Curl", "sets": 3, "rep_range": "10-12", "rest_sec": 60, "muscle_groups": ["biceps"]},
            {"name": "Overhead DB Tricep Extension", "sets": 3, "rep_range": "10-12", "rest_sec": 60, "muscle_groups": ["triceps"]}
          ]
        }
      ]
    },
    {
      "day_id": "lower_b",
      "label": "Lower B",
      "focus": "Agility & Core, then Hamstrings/Glutes",
      "blocks": [
        {
          "block_name": "Agility/Stability",
          "order_note": "perform first, while fresh",
          "effort_metric": "movement_quality",
          "exercises": [
            {"name": "Lateral Shuffle", "sets": 4, "rep_range": "20 sec", "rest_sec": 45, "muscle_groups": ["agility", "stability"]},
            {"name": "Single-Leg Hop & Stick", "sets": 3, "rep_range": "5/leg", "rest_sec": 60, "muscle_groups": ["stability", "ankle_knee_control"]},
            {"name": "Cable Pallof Press", "sets": 3, "rep_range": "10/side", "rest_sec": 45, "muscle_groups": ["core"]}
          ]
        },
        {
          "block_name": "Strength",
          "exercises": [
            {"name": "Smith Machine RDL", "sets": 3, "rep_range": "8-10", "rest_sec": 120, "muscle_groups": ["hamstrings", "glutes"]},
            {"name": "DB Bulgarian Split Squat", "sets": 2, "rep_range": "10/leg", "rest_sec": 90, "muscle_groups": ["quads", "glutes", "stability"]},
            {"name": "Leg Curl", "sets": 2, "rep_range": "10-12", "rest_sec": 90, "muscle_groups": ["hamstrings"]},
            {"name": "Seated Calf Raise", "sets": 2, "rep_range": "12-15", "rest_sec": 45, "muscle_groups": ["calves"]}
          ]
        }
      ],
      "conditional_notes": ["If a game is within 24 hrs: cap RDL at 2 working sets, stay a couple reps from failure"]
    }
  ],
  "weekly_volume_sets": {
    "back": 14,
    "chest": 10,
    "shoulders": 10,
    "hamstrings": 7,
    "quads": 7,
    "biceps": 6,
    "triceps": 6,
    "calves": 5
  }
}
```
