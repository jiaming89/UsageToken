## 0.1.7 - 2026-08-03

### Fixes

- Restore the standard Token terminology in the Chinese dashboard and prevent the final date labels in trend charts from overlapping.

## 0.1.6 - 2026-08-03

### Fixes

- Localize the dashboard UI and make all five dashboard views use responsive filters, readable charts, and scrollable detail lists.
- Show 10 day/week/month rows and 10 five-hour windows by default; show 50 sessions by default.
- Limit session and window charts to recent entries and use adaptive date labels to prevent overlapping axes.

## 0.1.5 - 2026-08-03

### Features

- Redesign the live dashboard in Chinese with global source filtering, cache status, manual refresh, and responsive filter controls.
- Render day, week, and month detail lists in scrollable batches of 10 rows; sessions in batches of 50; and 5-hour windows in batches of 10.
- Simplify long-list navigation so sessions and 5-hour windows are only shown in their respective tabs, with readable recent-item charts.

### Fixes

- Prevent overlapping date labels in the trend chart by displaying an adaptive set of axis labels.

## 0.1.3 - 2026-08-03

### Performance

- Add a live local `utoken` dashboard with cached background refresh and source fingerprints.
- Pre-aggregate project summaries in one pass and apply source/date filters before report aggregation.

## 0.1.2 - 2026-08-03

### Fixes

- Replace the conflicting `cc` executable with the `utoken` shortcut command.

## 0.1.1 - 2026-08-03

### Fixes

- Build the CLI before packing so the published package contains the `cc` and `usagetoken` executables.
