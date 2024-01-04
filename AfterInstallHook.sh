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

# Check if CodeDeploy agent is installed and running
if ! sudo service codedeploy-agent status; then
    echo "CodeDeploy agent not found, installing..."
    sudo apt-get update
    sudo apt-get install -y ruby
    cd /tmp
    wget https://aws-codedeploy-us-west-2.s3.us-west-2.amazonaws.com/latest/install
    chmod +x ./install
    sudo ./install auto
    sudo service codedeploy-agent start
fi

# Return to app directory and start the application
cd /home/ubuntu/test
npm run start
