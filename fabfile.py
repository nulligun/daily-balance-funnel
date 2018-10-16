from fabric.api import *
from fabric.contrib.project import rsync_project
from fabric.utils import puts
from fabric.operations import local
from fabric.contrib.files import sed
import os
import time
import socket

@task
def build():
    local("npm run build")

@task
def prod():
    env.port = 2221
    env.hosts.append('stevemulligan@ssh.outdoordevs.com')
    env.DEPLOY_TO = '/var/www/funnel/'

deploy_targets = [prod]

@task
def deploy():
    require('DEPLOY_TO', provided_by=deploy_targets)

    rsync_project(
        local_dir=os.getcwd() + '/',
        remote_dir=env.DEPLOY_TO + '/',
        extra_opts='-l',
        exclude=[],
        delete=True
    )
