#!/bin/bash
source ~/.bashrc
sudo chown -R ubuntu:ubuntu /home/ubuntu/test
cd /home/ubuntu/test
npm install
npm run start

