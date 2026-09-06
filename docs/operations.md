# Setup and operation

These are the steps for running this project on a Pi. My installation already uses a systemd service and a separate Windows launcher.

## Fresh Pi installation

Install Python dependencies on the Pi:

```bash
sudo apt update
sudo apt install python3-flask python3-psutil python3-waitress git
git clone https://github.com/KuroKamee/pi-pulse.git ~/pi-pulse
cd ~/pi-pulse
python3 collector.py
```

From a separate computer, forward local port 8765 to the Pi using `ssh -N -L 8765:127.0.0.1:8765 USER@PI_ADDRESS`. Replace USER and PI_ADDRESS with the Pi login and address. Visit http://127.0.0.1:8765/. The collector defaults to loopback and has no browser login of its own.

## Automatic startup

I use systemd to start the collector automatically. On a fresh installation, create `/etc/systemd/system/pi-pulse.service` with these contents, replacing USER with the Linux username:

```ini
[Unit]
Description=Pi Pulse collector
After=network.target

[Service]
Type=simple
User=USER
WorkingDirectory=/home/USER/pi-pulse
ExecStart=/usr/bin/python3 -u /home/USER/pi-pulse/collector.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Stop any manually running collector with Ctrl+C, then run `sudo systemctl daemon-reload` and `sudo systemctl enable --now pi-pulse.service`.

## Pi-hole connection

Pi-hole must already be installed on the same Pi, with its API at http://127.0.0.1/api/. Run `python3 ~/pi-pulse/connect_pihole.py`, enter the Pi-hole credential at its prompt, then restart the collector service. Setup stores the credential privately with mode 0600. If the Pi-hole admin address differs from the original home setup, edit the admin link in `static/index.html`.

## Daily use

Leave the Pi powered on for filtering. Close the laptop or dashboard whenever you like. Reopen the SSH tunnel or Windows launcher to view the dashboard again. Clients manually configured to use this Pi for DNS need a working Pi; change their DNS back to Automatic if taking it offline.

To check the collector, use `systemctl status pi-pulse.service --no-pager`. For logs, use `journalctl -u pi-pulse.service -n 30 --no-pager`.

## Backups

Keep Pi-hole Teleporter exports and a separate Pi Pulse archive containing its source, history database and service definition. Stop the collector while copying SQLite, then start it again. Store another copy away from the Pi. Exclude the private Pi-hole credential when sharing a project archive; reconnect it with the setup script after restoring. Backup exports can contain private settings and must not be committed to Git.

