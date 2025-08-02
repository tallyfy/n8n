# n8n-nodes-tallyfy

This is an n8n community node that lets you automate and integrate [Tallyfy](https://tallyfy.com) in your n8n workflows.

Tallyfy is a workflow automation platform that specializes in **people-driven tasks** - coordinating human work, approvals, and collaborative processes. It complements n8n perfectly: while n8n excels at **automated, unattended tasks** (API calls, data processing, system integration), Tallyfy handles the human elements of your workflows. Together, they create complete end-to-end automation that seamlessly blends automated processes with human decision points and actions.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

### Community Installation

1. Go to **Settings > Community Nodes**
2. Select **Install**
3. Enter `n8n-nodes-tallyfy` in the input field
4. Agree to the risks of using community nodes
5. Select **Install**

### Manual Installation

To install this node manually in n8n:

```bash
npm install n8n-nodes-tallyfy
```

Then restart your n8n instance.

## Operations

### Resources

The Tallyfy node supports **60+ operations** across 10 resources:

#### 📘 Blueprint (Process Templates)
*Note: Blueprints in the API are called "Templates" in the Tallyfy UI*
- **Get** - Get a specific blueprint/template
- **Get Many** - List all blueprints/templates with filtering options
- **Create** - Create a new blueprint/template with required type field
- **Update** - Update an existing blueprint/template
- **Delete** - Delete a blueprint/template

#### 🔄 Process (Running Instances)
- **Launch** - Launch a new process from a blueprint
- **Get** - Get a specific process
- **Get Many** - List all processes with filtering options
- **Get Tasks** - Get all tasks in a process
- **Update** - Update process metadata
- **Archive** - Archive a process

#### ✅ Task
- **Get** - Get a specific task
- **Get Many** - List all tasks with filtering options
- **Create One-Off** - Create standalone task with full configuration
- **Update Properties** - Update title, deadline, and assignees
- **Clone** - Duplicate an existing task
- **Complete** - Mark a task as complete
- **Delete** - Delete a task

#### 📝 Form Field
- **Get Fields** - Get all form fields from a process or task
- **Update Value** - Update form field value (supports member and guest access)

#### 💬 Comment
- **Create** - Add a regular comment to a task
- **Update** - Update an existing comment
- **Delete** - Delete a comment
- **Create Bot** - Add an automated bot comment
- **Report Problem** - Report a problem/blocker on a task
- **Resolve Issue** - Mark a problem thread as resolved

#### 👤 User
- **Get Current** - Get current authenticated user info
- **Get** - Get a specific user
- **Get Many** - List all users in organization
- **Invite** - Invite a user with role assignment
- **Update Role** - Change user role (admin/standard/viewer)
- **Enable** - Activate a disabled user
- **Disable** - Deactivate a user
- **Convert to Guest** - Convert member to guest

#### 👥 Guest
- **Create** - Create a new guest user
- **Get** - Get a specific guest
- **Get Many** - List all guests
- **Update** - Update guest information
- **Convert to Member** - Upgrade guest to full member
- **Delete** - Remove a guest

#### 👨‍👩‍👧‍👦 Group
- **Create** - Create a new group
- **Get** - Get a specific group
- **Get Many** - List all groups
- **Update** - Update group and manage members
- **Delete** - Delete a group

#### 🔍 Search
- **Global** - Search across all resources
- **Tasks** - Search only tasks
- **Processes** - Search only processes
- **Blueprints** - Search only blueprints

#### 🔎 ID Finder
- **Find Process ID** - Find process by name
- **Find Task ID** - Find task by title
- **Find Blueprint ID** - Find blueprint by name
- **Find Form Field ID** - Get form field IDs from a process
- **Find User ID** - Find user by email or name
- **Find Group ID** - Find group by name

## Credentials

To use this node, you need to create Tallyfy API credentials:

1. **Access Token**: Get your Personal Access Token from your Tallyfy account:
   - Log into Tallyfy
   - Go to Settings > Integrations > REST API
   - Generate or copy your access token

2. **Organization ID**: Find your organization ID from your Tallyfy URL:
   - Look at your browser URL when logged into Tallyfy
   - It will be in the format: `https://app.tallyfy.com/org/YOUR_ORG_ID`
   - Copy the YOUR_ORG_ID part

3. **Base URL** (optional): Default is `https://go.tallyfy.com/api`
   - Only change this if you're using a different Tallyfy environment

## Usage Examples

### Example 1: Launch a Process

Launch a new process instance from a blueprint:

1. Add a Tallyfy node to your workflow
2. Select **Process** as the resource
3. Select **Launch** as the operation
4. Enter the Blueprint ID
5. Enter a name for the new process
6. Optionally add additional fields like summary, due date, or tags

### Example 2: Complete Tasks Automatically

Complete tasks based on external triggers:

1. Add a trigger node (webhook, schedule, etc.)
2. Add a Tallyfy node
3. Select **Task** as the resource
4. Select **Complete** as the operation
5. Use expressions to pass the Task ID dynamically
6. Optionally add a completion comment

### Example 3: Create Comments from External Sources

Add comments to tasks from external systems:

1. Receive data from another system (email, Slack, etc.)
2. Add a Tallyfy node
3. Select **Comment** as the resource
4. Select **Create** as the operation
5. Map the task ID and comment text from your input data

### Example 4: Sync Users

Keep user lists synchronized:

1. Add a Tallyfy node to get all users
2. Select **User** as the resource
3. Select **Get Many** as the operation
4. Process the user list as needed
5. Use another Tallyfy node to invite missing users

## Advanced Features

### Filtering and Pagination

When using "Get Many" operations, you can:
- Filter by status, tags, or search terms
- Sort results by various fields
- Control pagination with the "Return All" option or set specific limits

### Error Handling

The node includes built-in error handling:
- Continues on fail option for batch processing
- Detailed error messages for troubleshooting
- Automatic retry with proper authentication headers

### Dynamic Data

All fields support n8n expressions, allowing you to:
- Use data from previous nodes
- Build dynamic queries
- Create conditional workflows

## API Rate Limits

Tallyfy API has the following rate limits:
- 600 requests per minute per IP address
- Automatic handling of rate limit responses
- Consider using delays between bulk operations

## Support

For complete integration documentation and setup guides, visit: [Tallyfy n8n Integration Guide](https://tallyfy.com/products/pro/integrations/middleware/n8n/)

For issues specific to this node, please create an issue on [GitHub](https://github.com/tallyfy/n8n/issues).

For general n8n support, visit the [n8n community forum](https://community.n8n.io/).

For Tallyfy API documentation, visit [Tallyfy API Docs](https://go.tallyfy.com/api/).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](https://github.com/tallyfy/n8n/blob/main/LICENSE)

## Resources

* [Tallyfy n8n Integration Guide](https://tallyfy.com/products/pro/integrations/middleware/n8n/) - Complete setup and usage documentation
* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [Tallyfy API documentation](https://go.tallyfy.com/api/)
* [Tallyfy website](https://tallyfy.com)