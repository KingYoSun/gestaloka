#!/bin/bash

# Fix permissions for neo4j/schema directory

echo "Fixing permissions for neo4j/schema directory..."

# Get current user and group
CURRENT_USER=$(id -u)
CURRENT_GROUP=$(id -g)

# Fix ownership
sudo chown -R $CURRENT_USER:$CURRENT_GROUP neo4j/schema

# Fix permissions (755 for directories, 644 for files)
find neo4j/schema -type d -exec chmod 755 {} \;
find neo4j/schema -type f -exec chmod 644 {} \;

echo "Permissions fixed. You can now track these files with git."
echo "Run 'git status' to verify."