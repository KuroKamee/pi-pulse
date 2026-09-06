# My learning notes

I started this project to get hands-on experience with a Raspberry Pi and build something I would actually use. These are my notes on the setup, the problems I ran into, and the parts I’m still working to understand.

## Getting the Pi connected

My first challenge was getting from an unconfigured Pi to a device I could reach from my laptop. I prepared the microSD card on my PC, set up Wi-Fi, and then used my laptop for the rest of the project.

I ran into hostname resolution problems when trying to connect. Using the Pi’s local IP address helped me get past that. I also worked with my dad to get an address reservation configured in our Deco router, so the address my devices use for Pi-hole would stay consistent.

The distinction I keep in mind is that a hostname is a name that has to be resolved, while an IP address tells the connection where to go. If the name does not resolve, that alone does not tell me whether the Pi is powered off.

## Windows PowerShell versus the Pi terminal

During an update, I pasted Linux commands into Windows PowerShell and got errors. I needed to connect over SSH first.

Now I check the prompt before running commands. `PS C:\...` means I am still on Windows. A prompt such as `casp@casppi` means I am in the Pi’s terminal. Copying a file with `scp` and connecting with `ssh` are separate steps.

## The collector and the dashboard

I originally asked whether I had to leave the website open and what would happen if I shut down my laptop.

The collector runs on the Pi. It reads the system measurements and saves a snapshot every 30 seconds. The dashboard runs in my browser and requests those readings. That means closing my laptop stops me viewing the data, but it does not stop the Pi collecting it.

The SSH tunnel gives my laptop a connection to the dashboard service on the Pi. If that tunnel closes, the page can become unavailable even though the service is still running. I ran into that while updating the project and had to reopen the connection.

## Following a temperature reading through the code

This is the path I use to understand how the pieces connect:

1. Linux exposes the CPU sensor at `/sys/class/thermal/thermal_zone0/temp`.
2. `collector.py` converts the sensor value from millidegrees to degrees Celsius. For example, 50000 becomes 50 °C.
3. The `/api/metrics` route returns the measurements as JSON.
4. `static/app.js` fetches the response and updates the page.
5. The health checks compare the reading with the warning thresholds.

The history recorder separately saves snapshots in SQLite. The chart reads those saved samples, which is why its last point can differ from the live temperature.

## Making the graph easier to read

The original graph did not make it easy to tell what the temperature was currently at or what it averaged. I wanted labels and numbers that answered those questions directly.

The dashboard now shows the current reading, sample average, minimum, and maximum, plus labeled temperature and time axes. I can inspect a saved reading with the slider. This was a useful reminder that collecting data and making it understandable are different parts of a project.

## Connecting my devices to Pi-hole

I configured DNS on my laptop and iPhone instead of changing it for the entire home network. I checked the Pi-hole query log and used an ad-block test page. Afterward, I noticed fewer ads.

The test did not block every target. Pi-hole filters domain lookups, so it cannot remove every kind of ad. Browser filtering can also affect a test result. The query log is useful for checking which requests actually reached Pi-hole.

Pi Pulse reads Pi-hole’s statistics; it is not the component doing the DNS blocking.

## Missing information is different from a good result

One detail in the health panel is that a missing reading should say it is unavailable. A sensor that cannot be read should not look like a temperature of zero, and an API connection failure should not look like zero blocked requests.

Similarly, if the dashboard cannot read the Pi-hole API, I still need to check whether DNS itself is working. The dashboard does not have enough information to declare the service down just from that error.

## Keeping it running and keeping backups

I set up the collector as a systemd service so it starts with the Pi. I also saved a Pi-hole Teleporter backup and a separate Pi Pulse backup. The Pi Pulse backup includes the saved history; the public source package does not.

Keeping a backup and successfully restoring one are different milestones. I have saved the backups, but I still want to test a restore on spare storage.

## What I am still learning

I want to get more comfortable reading the Python and JavaScript, tracing an error from the browser back to the collector, and making small changes without following a full set of instructions.

My next code exercise is to trace `healthChecks` in `static/app.js` and its tests in `test_dashboard.cjs`. I want to be able to explain why storage is checked both as a percentage and as an amount of free space, and how a stale reading becomes unavailable.
