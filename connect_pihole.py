"""Run on the Pi as casp: python3 connect_pihole.py"""
import getpass
import os
import tempfile
from pihole_client import PiHole, PASSWORD_FILE


def main():
    print('Connect Pi Pulse to the Pi-hole running on this Pi.')
    print('Enter your Pi-hole web password or application password. Input is hidden.')
    password = getpass.getpass('Pi-hole password: ')
    if not password:
        print('No password entered. Nothing changed.')
        return 1
    client = PiHole(password_reader=lambda: password)
    try:
        result = client.summary()
        if result['state'] != 'connected':
            print(result['message'])
            print('Nothing saved. If using two-factor authentication, use a Pi-hole application password.')
            return 1
        fd, temporary = tempfile.mkstemp(prefix='.pihole-password-', dir=PASSWORD_FILE.parent)
        try:
            with os.fdopen(fd, 'w') as file:
                file.write(password)
            os.replace(temporary, PASSWORD_FILE)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print('Connected. Password saved on this Pi with owner-only file access.')
        print('Restart Pi Pulse: sudo systemctl restart pi-pulse.service')
        return 0
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
