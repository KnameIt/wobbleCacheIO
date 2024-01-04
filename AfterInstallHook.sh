#!/bin/bash
source ~/.bashrc

# Ensure the directory /home/ubuntu/test exists
if [ ! -d "/home/ubuntu/test" ]; then
  mkdir -p /home/ubuntu/test
fi

# Change the owner of the directory
sudo chown -R ubuntu:ubuntu /home/ubuntu/test

# Navigate to the directory
cd /home/ubuntu/test

# Check if PM2 is installed, if not, install it
if ! command -v pm2 &> /dev/null
then
    echo "PM2 not found, installing..."
    npm install -g pm2
fi

# Install npm packages and start the application
npm install
npm run start
