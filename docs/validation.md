# Testing notes

## What I checked on my Pi

I installed the collector, opened the dashboard through the SSH tunnel, and checked that live readings and saved history appeared. I connected Pi-hole and verified that the dashboard showed its query counts and blocking status.

After installing the health update, I checked that the new panel appeared and showed “Checks passed.” My screenshots show the health panel, Pi-hole activity, and the labeled history chart. I also configured my laptop and iPhone to use Pi-hole and noticed fewer ads.

## Automated checks included with the project

The development checks for the September 6, 2026 release passed:

| Command | Result |
| --- | --- |
| `python3 -m unittest discover -v` | 12 tests passed |
| `node test_dashboard.cjs` | Chart and health checks passed |
| `node --check static/app.js` | Syntax check passed |

These cover sensor conversion and missing sensors, API errors, history retention and restart behavior, credential handling, graph statistics, gaps, and health rules. Health cases include the temperature boundaries at 75/80 °C, low absolute disk space, disabled or failed blocking, and stale readings.

The automated checks were run in the development environment with coding assistance. My checks on the Pi were the installation and use described above.

## What these checks do not establish

I did not deliberately overheat the Pi or fill its storage to test warning states on the hardware; those cases were checked by the automated tests. A screenshot confirms the displayed state at that moment, not continuous uptime. My browser ad-block test also cannot isolate Pi-hole from any browser filtering.

I have made backups, but a complete restore onto spare storage is still on my project list.
