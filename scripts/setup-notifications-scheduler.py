#!/usr/bin/env python3
"""Provision notification scheduling without printing credentials or redeploying.

Run --prepare before the CI deploy to create the secret/IAM binding; run again
without it after the notification-enabled revision is serving traffic.
"""
import argparse
import secrets
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', required=True)
parser.add_argument('--region', default='us-central1')
parser.add_argument('--service', default='zomaal-backend')
parser.add_argument('--prepare', action='store_true')
args = parser.parse_args()


def gc(*command, data=None, check=True):
    result = subprocess.run(['gcloud', '--quiet', '--project', args.project, *command],
                            input=data, capture_output=True, text=True)
    if check and result.returncode:
        # Never echo a command or its output: scheduler arguments contain secrets.
        raise RuntimeError(f'gcloud {command[0]} {command[1]} failed (exit {result.returncode})')
    return result


name = 'zomaal-notifications-scheduler-secret'
gc('services', 'enable', 'cloudscheduler.googleapis.com')
if gc('secrets', 'describe', name, check=False).returncode:
    gc('secrets', 'create', name, '--replication-policy=automatic')
    gc('secrets', 'versions', 'add', name, '--data-file=-', data=secrets.token_urlsafe(48))
number = gc('projects', 'describe', args.project, '--format=value(projectNumber)').stdout.strip()
gc('secrets', 'add-iam-policy-binding', name,
   f'--member=serviceAccount:{number}-compute@developer.gserviceaccount.com',
   '--role=roles/secretmanager.secretAccessor')
print('Notification scheduler secret and runtime access ready.')
if not args.prepare:
    service_url = gc('run', 'services', 'describe', args.service, '--region', args.region,
                     '--format=value(status.url)').stdout.strip()
    secret = gc('secrets', 'versions', 'access', 'latest', '--secret', name).stdout.strip()
    job = 'zomaal-notifications-evaluate'
    exists = gc('scheduler', 'jobs', 'describe', job, '--location', args.region, check=False).returncode == 0
    gc('scheduler', 'jobs', 'update' if exists else 'create', 'http', job,
       '--location', args.region, '--schedule=*/5 * * * *', '--time-zone=Etc/UTC',
       f'--uri={service_url}/internal/notifications/run', '--http-method=POST',
       '--attempt-deadline=120s', '--max-retry-attempts=1', '--min-backoff=60s',
       f'--{"update-headers" if exists else "headers"}=x-zomaal-scheduler-secret={secret}')
    print('Notification evaluation job configured every five minutes.')
