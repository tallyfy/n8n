# n8n-nodes-tallyfy

This is an n8n community node that lets you automate and integrate [Tallyfy](https://tallyfy.com) in your n8n workflows.

Tallyfy is a workflow automation platform that specializes in **people-driven tasks**, coordinating human work, approvals, and collaborative processes. It complements n8n perfectly: while n8n excels at **automated, unattended tasks** (API calls, data processing, system integration), Tallyfy handles the human elements of your workflows. Together they create complete end-to-end automation that blends automated processes with human decision points and actions.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

This package ships two nodes: the **Tallyfy** node (actions) and the **Tallyfy Trigger** node (start a workflow when things happen in Tallyfy).

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

The **Tallyfy** node exposes **96 operations across 12 resources**, plus the **Tallyfy Trigger** node described further below.

### Tallyfy node (actions)

#### 📘 Blueprint (process templates)
*Blueprints are called "Templates" in the Tallyfy UI.*

Get, Get Many, Create (procedure, form, or document), Update, Delete, Clone, Get Kickoff Fields, and List Steps.

#### 🔄 Process (running instances)

Launch a process from a blueprint (with kickoff form values, see below), Get, Get Many, Update, Archive, Reactivate, Get Tasks, Complete Kickoff Form, and Reopen Kickoff Form.

#### ✅ Task

Create One-Off, Get, Get Many, Update Properties, Complete (with approve/reject for approval steps), Reopen, Clone, and Delete. Also Get My Tasks, Get User Tasks, and Get Guest Tasks, plus Get Process Task and Update Process Task for working with a task inside a specific process (run).

#### 📝 Form Field

Get Fields (from a process or blueprint) and Update Value (as a member or a guest). On template steps you can Add, Update, Move, and Delete a field, and Get or Update its dropdown options. You can also manage the template kickoff (prerun) form: Add, Update, Delete, and Reorder kickoff fields.

#### 💬 Comment

Create, Update, Delete, and List comments on a task. Also Create Bot Comment (posts without sending notifications), Report Problem (raises an issue), and Resolve Issue.

#### 👤 User (member)

Get, Get Many, Get Current (the authenticated user), Invite, Update Role (admin, standard, or light), Enable, Disable, Convert to Guest, and Get Organization.

#### 👥 Guest

Create, Get, Get Many, Update, Delete, Enable, Disable, and Convert to Member.

#### 👨‍👩‍👧‍👦 Group

Create, Get, Get Many, Update (including membership), and Delete.

#### 🏷️ Tag

Get Many, Create, Update, and Delete tags, plus attach or detach a tag on a template or a process (Tag Template, Untag Template, Tag Process, Untag Process).

#### 📁 Folder

Get Many, Create, Update, and Delete folders, plus Add To Folder and Remove From Folder for organizing templates and processes.

#### 🔍 Search

Global Search across resources, plus scoped searches over Tasks, Processes, Blueprints, and Snippets.

#### 🔎 ID Finder

Resolve an ID from a name or search term: Find Process ID, Find Task ID, Find Blueprint ID, Find Form Field ID, Find User ID, and Find Group ID. Handy for feeding IDs into later nodes without hard-coding them.

### Kickoff (prerun) form values

When you **Launch** a process, you can set the blueprint's kickoff (prerun) form values in the same step. Add a "Kickoff Field Values" entry per field, identifying the field by its ID, alias, or exact label. Each value is resolved against the template's kickoff fields and encoded by field type:

- **Dropdown** or **radio**: the option text, matched exactly.
- **Multi-select**: comma-separated option texts.
- **Text**, **number**, or **date**: the value as-is.

An entry that matches no kickoff field fails the execution instead of being silently dropped. Use the blueprint **Get Kickoff Fields** operation to list a template's fields.

### Tallyfy Trigger node

The **Tallyfy Trigger** node starts a workflow when something happens in Tallyfy. It has two modes:

- **Polling** (default, works for everyone): the node checks Tallyfy periodically for **New Process Launched** (optionally filtered to one template), **Task Completed**, **Task Assigned To Me**, and **Comment Or Issue Added** (scoped to a single process or to all processes of a template). No public URL or admin rights are needed, and it de-duplicates so activation does not replay the backlog.
- **Instant (Webhook)**: Tallyfy pushes events to n8n in real time. On activation the node registers an organization-scope webhook watcher via the Tallyfy watcher API, and removes it on deactivation. You can select any of **Process Launched**, **Process Completed**, **Task Completed**, **Task Assigned**, **Comment Added**, **Issue Raised**, and **Issue Resolved**. This mode needs an organization-admin token and the Tallyfy organization-webhook backend (rolling out); if your organization does not have it enabled yet, use Polling.

## Credentials

To use these nodes, create a **Tallyfy API** credential:

1. **Access Token**: your Tallyfy Personal Access Token. In Tallyfy, go to **Settings > Integrations > REST API** and generate or copy your token.
2. **Organization ID**: found in your Tallyfy URL, for example `https://go.tallyfy.com/organizations/YOUR_ORG_ID`. Copy the `YOUR_ORG_ID` part.
3. **Base URL** (optional): defaults to `https://go.tallyfy.com/api`. Only change this if you use a different Tallyfy environment.

The credential authenticates with a Bearer token (plus an `X-Tallyfy-Client: n8n` header) and is verified against the Tallyfy `/me` endpoint when you save it.

## Usage Examples

### Example 1: Launch a process

Launch a new process instance from a blueprint:

1. Add a Tallyfy node to your workflow
2. Select **Process** as the resource
3. Select **Launch** as the operation
4. Enter the Blueprint ID and a name for the new process
5. Optionally add Kickoff Field Values to pre-fill the launch form, and set additional fields like summary or starred

### Example 2: Complete tasks automatically

Complete tasks based on external triggers:

1. Add a trigger node (webhook, schedule, etc.)
2. Add a Tallyfy node
3. Select **Task** as the resource and **Complete** as the operation
4. Use expressions to pass the Task ID dynamically
5. For approval steps, set the Approval Decision to approve or reject

### Example 3: Create comments from external sources

Add comments to tasks from external systems:

1. Receive data from another system (email, Slack, etc.)
2. Add a Tallyfy node
3. Select **Comment** as the resource and **Create** as the operation
4. Map the Task ID and comment content from your input data

### Example 4: Sync users

Keep user lists synchronized:

1. Add a Tallyfy node, select **User** and **Get Many**
2. Process the user list as needed
3. Use another Tallyfy node with **Invite** to add missing users

### Example 5: React to Tallyfy events

Start a workflow when work happens in Tallyfy:

1. Add a **Tallyfy Trigger** node as the first node
2. Choose **Polling** (works everywhere) or **Instant (Webhook)** if your org has the webhook backend
3. Select the events to listen for (for example, Task Completed)
4. Wire the trigger output into downstream nodes

## Advanced Features

### Filtering and Pagination

When using "Get Many" operations, you can:
- Filter by status, tags, or search terms
- Control pagination with the "Return All" option or set specific limits

### Error Handling

The node includes built-in error handling:
- Continue On Fail option for batch processing
- Detailed error messages for troubleshooting
- Automatic authentication headers on every request

### Dynamic Data

All fields support n8n expressions, allowing you to:
- Use data from previous nodes
- Build dynamic queries
- Create conditional workflows

## Compatibility

- Runs as an n8n community node (nodes API version 1). Install it from **Settings > Community Nodes** or with `npm install n8n-nodes-tallyfy`.
- Requires Node.js 20.15 or newer.
- Built and tested against `n8n-workflow` 2.16.

**Version note**: this package is on the 1.1.x line. For what each release contains, see [CHANGELOG.md](CHANGELOG.md). For the version you would install right now, ask npm rather than this page:

```bash
npm view n8n-nodes-tallyfy version
```

Releases are published by GitHub Actions using npm trusted publishing (OIDC), with SLSA provenance and an npm publish attestation, so every published version can be traced back to the commit and workflow that built it.

## API Rate Limits

Tallyfy applies rate limits to its API. The node passes rate-limit responses through, so add delays between large bulk operations if you hit them.

## Support

For complete integration documentation and setup guides, visit the [Tallyfy n8n Integration Guide](https://tallyfy.com/products/pro/integrations/middleware/n8n/).

For issues specific to these nodes, please open an issue on [GitHub](https://github.com/tallyfy/n8n/issues).

For general n8n support, visit the [n8n community forum](https://community.n8n.io/).

For Tallyfy API documentation, visit the [Tallyfy API Docs](https://go.tallyfy.com/api/).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](https://github.com/tallyfy/n8n/blob/main/LICENSE)

## Resources

* [Tallyfy n8n Integration Guide](https://tallyfy.com/products/pro/integrations/middleware/n8n/) - Complete setup and usage documentation
* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [Tallyfy API documentation](https://go.tallyfy.com/api/)
* [Tallyfy website](https://tallyfy.com)
