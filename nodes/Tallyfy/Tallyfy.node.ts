import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';

import { NodeConnectionType } from 'n8n-workflow';

export class Tallyfy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tallyfy',
		name: 'tallyfy',
		icon: 'file:tallyfy.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Tallyfy workflow automation platform',
		defaults: {
			name: 'Tallyfy',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'tallyfyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Blueprint',
						value: 'blueprint',
						description: 'Process templates',
					},
					{
						name: 'Process',
						value: 'process',
						description: 'Process instances (runs)',
					},
					{
						name: 'Task',
						value: 'task',
						description: 'Individual tasks',
					},
					{
						name: 'Form Field',
						value: 'formField',
						description: 'Form fields in tasks',
					},
					{
						name: 'Comment',
						value: 'comment',
						description: 'Comments on tasks or processes',
					},
					{
						name: 'User',
						value: 'user',
						description: 'User management',
					},
					{
						name: 'Guest',
						value: 'guest',
						description: 'Guest management',
					},
					{
						name: 'Group',
						value: 'group',
						description: 'Group management',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search across Tallyfy',
					},
					{
						name: 'ID Finder',
						value: 'idFinder',
						description: 'Find IDs for various resources',
					},
				],
				default: 'task',
				required: true,
			},

			// ===== BLUEPRINT OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get a blueprint',
						action: 'Get a blueprint',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many blueprints',
						action: 'Get many blueprints',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a blueprint',
						action: 'Create a blueprint',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a blueprint',
						action: 'Update a blueprint',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a blueprint',
						action: 'Delete a blueprint',
					},
				],
				default: 'getAll',
			},

			// ===== PROCESS OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['process'],
					},
				},
				options: [
					{
						name: 'Launch',
						value: 'launch',
						description: 'Launch a new process from a blueprint',
						action: 'Launch a process',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a process',
						action: 'Get a process',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many processes',
						action: 'Get many processes',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a process',
						action: 'Update a process',
					},
					{
						name: 'Archive',
						value: 'archive',
						description: 'Archive a process (soft delete)',
						action: 'Archive a process',
					},
					{
						name: 'Get Tasks',
						value: 'getTasks',
						description: 'Get all tasks in a process',
						action: 'Get process tasks',
					},
				],
				default: 'launch',
			},

			// ===== TASK OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['task'],
					},
				},
				options: [
					{
						name: 'Create One-Off',
						value: 'createOneOff',
						description: 'Create a standalone task with all properties',
						action: 'Create one-off task',
					},
					{
						name: 'Complete',
						value: 'complete',
						description: 'Complete a task',
						action: 'Complete a task',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a task',
						action: 'Get a task',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many tasks',
						action: 'Get many tasks',
					},
					{
						name: 'Update Properties',
						value: 'updateProperties',
						description: 'Update task properties (title, deadline, assignees, etc.)',
						action: 'Update task properties',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a task',
						action: 'Delete a task',
					},
					{
						name: 'Clone',
						value: 'clone',
						description: 'Clone a task',
						action: 'Clone a task',
					},
				],
				default: 'complete',
			},

			// ===== FORM FIELD OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['formField'],
					},
				},
				options: [
					{
						name: 'Update Value',
						value: 'updateValue',
						description: 'Update a form field value in a task',
						action: 'Update form field value',
					},
					{
						name: 'Get Fields',
						value: 'getFields',
						description: 'Get all form fields for a task or process',
						action: 'Get form fields',
					},
				],
				default: 'updateValue',
			},

			// ===== COMMENT OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['comment'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Add a comment to a task',
						action: 'Create a comment',
					},
					{
						name: 'Create Bot Comment',
						value: 'createBot',
						description: 'Add a bot comment (no notifications)',
						action: 'Create bot comment',
					},
					{
						name: 'Report Problem',
						value: 'reportProblem',
						description: 'Report a problem/blocker on a task',
						action: 'Report problem',
					},
					{
						name: 'Resolve Issue',
						value: 'resolveIssue',
						description: 'Mark an issue as resolved',
						action: 'Resolve issue',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a comment',
						action: 'Update a comment',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a comment',
						action: 'Delete a comment',
					},
				],
				default: 'create',
			},

			// ===== USER OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['user'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get a user',
						action: 'Get a user',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many users',
						action: 'Get many users',
					},
					{
						name: 'Get Current',
						value: 'getCurrent',
						description: 'Get current authenticated user',
						action: 'Get current user',
					},
					{
						name: 'Invite',
						value: 'invite',
						description: 'Invite a user to organization',
						action: 'Invite a user',
					},
					{
						name: 'Update Role',
						value: 'updateRole',
						description: 'Update user role',
						action: 'Update user role',
					},
					{
						name: 'Disable',
						value: 'disable',
						description: 'Disable a user',
						action: 'Disable user',
					},
					{
						name: 'Enable',
						value: 'enable',
						description: 'Enable a user',
						action: 'Enable user',
					},
					{
						name: 'Convert to Guest',
						value: 'convertToGuest',
						description: 'Convert member to guest',
						action: 'Convert to guest',
					},
				],
				default: 'getAll',
			},

			// ===== GUEST OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['guest'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a guest',
						action: 'Create a guest',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a guest',
						action: 'Get a guest',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many guests',
						action: 'Get many guests',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update guest information',
						action: 'Update a guest',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a guest',
						action: 'Delete a guest',
					},
					{
						name: 'Convert to Member',
						value: 'convertToMember',
						description: 'Convert guest to member',
						action: 'Convert to member',
					},
				],
				default: 'create',
			},

			// ===== GROUP OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['group'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a group',
						action: 'Create a group',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a group',
						action: 'Get a group',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many groups',
						action: 'Get many groups',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update group (including members)',
						action: 'Update a group',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a group',
						action: 'Delete a group',
					},
				],
				default: 'create',
			},

			// ===== SEARCH OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
				options: [
					{
						name: 'Global Search',
						value: 'global',
						description: 'Search across all Tallyfy resources',
						action: 'Global search',
					},
					{
						name: 'Search Tasks',
						value: 'tasks',
						description: 'Search for tasks',
						action: 'Search tasks',
					},
					{
						name: 'Search Processes',
						value: 'processes',
						description: 'Search for processes',
						action: 'Search processes',
					},
					{
						name: 'Search Blueprints',
						value: 'blueprints',
						description: 'Search for blueprints',
						action: 'Search blueprints',
					},
				],
				default: 'global',
			},

			// ===== ID FINDER OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['idFinder'],
					},
				},
				options: [
					{
						name: 'Find Process ID',
						value: 'findProcessId',
						description: 'Find process ID by name or search',
						action: 'Find process ID',
					},
					{
						name: 'Find Task ID',
						value: 'findTaskId',
						description: 'Find task ID by name or search',
						action: 'Find task ID',
					},
					{
						name: 'Find Blueprint ID',
						value: 'findBlueprintId',
						description: 'Find blueprint ID by name or search',
						action: 'Find blueprint ID',
					},
					{
						name: 'Find Form Field ID',
						value: 'findFormFieldId',
						description: 'Find form field ID in a task or process',
						action: 'Find form field ID',
					},
					{
						name: 'Find User ID',
						value: 'findUserId',
						description: 'Find user ID by email or name',
						action: 'Find user ID',
					},
					{
						name: 'Find Group ID',
						value: 'findGroupId',
						description: 'Find group ID by name',
						action: 'Find group ID',
					},
				],
				default: 'findProcessId',
			},

			// ================================
			// FIELD DEFINITIONS FOR EACH RESOURCE
			// ================================

			// ===== BLUEPRINT FIELDS =====
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['get', 'update', 'delete'],
					},
				},
				description: 'The ID of the blueprint',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create', 'update'],
					},
				},
				description: 'The title of the blueprint (max 250 characters)',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{
						name: 'Procedure',
						value: 'procedure',
					},
					{
						name: 'Form',
						value: 'form',
					},
					{
						name: 'Document',
						value: 'document',
					},
				],
				default: 'procedure',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create'],
					},
				},
				description: 'The type of blueprint',
			},

			// ===== PROCESS FIELDS =====
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['get', 'update', 'archive', 'getTasks'],
					},
				},
				description: 'The ID of the process',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description: 'The ID of the blueprint to launch',
			},
			{
				displayName: 'Process Name',
				name: 'processName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description: 'Name for the new process instance',
			},

			// ===== TASK FIELDS =====
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete', 'get', 'updateProperties', 'delete', 'clone'],
					},
				},
				description: 'The ID of the task',
			},

			// One-off task creation fields
			{
				displayName: 'Task Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'Title of the task (max 600 characters)',
			},
			{
				displayName: 'Task Type',
				name: 'task_type',
				type: 'options',
				options: [
					{
						name: 'Task',
						value: 'task',
					},
					{
						name: 'Approval',
						value: 'approval',
					},
					{
						name: 'Expiring',
						value: 'expiring',
					},
					{
						name: 'Email',
						value: 'email',
					},
				],
				default: 'task',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'The type of task',
			},
			{
				displayName: 'Deadline',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'The deadline for the task',
			},

			// Required fields for task update
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				description: 'Title of the task (required for update)',
			},
			{
				displayName: 'Deadline',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				description: 'Deadline for the task (required for update)',
			},
			// Task property update fields
			{
				displayName: 'Properties to Update',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Property',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				options: [
					{
						displayName: 'Task Type',
						name: 'task_type',
						type: 'options',
						options: [
							{
								name: 'Task',
								value: 'task',
							},
							{
								name: 'Approval',
								value: 'approval',
							},
							{
								name: 'Expiring',
								value: 'expiring',
							},
							{
								name: 'Email',
								value: 'email',
							},
						],
						default: 'task',
						description: 'Change the task type',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of user IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Max Assignable',
						name: 'max_assignable',
						type: 'number',
						default: 0,
						description: 'Maximum number of assignees allowed',
					},
					{
						displayName: 'Prevent Guest Comment',
						name: 'prevent_guest_comment',
						type: 'boolean',
						default: false,
						description: 'Prevent guests from commenting',
					},
					{
						displayName: 'Top Secret',
						name: 'top_secret',
						type: 'boolean',
						default: false,
						description: 'Mark task as top secret',
					},
				],
			},

			// Task one-off additional fields
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff', 'complete'],
					},
				},
				options: [
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Task summary',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of user IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Start Date',
						name: 'started_at',
						type: 'dateTime',
						default: '',
						description: 'When the task should start',
					},
					{
						displayName: 'Everyone Must Complete',
						name: 'everyone_must_complete',
						type: 'boolean',
						default: false,
						description: 'All assignees must complete the task',
					},
					{
						displayName: 'Comment',
						name: 'comment',
						type: 'string',
						typeOptions: {
							rows: 4,
						},
						default: '',
						description: 'Comment to add when completing the task',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhook',
						type: 'string',
						default: '',
						description: 'Webhook to call on task events',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tag IDs',
					},
				],
			},

			// ===== FORM FIELD FIELDS =====
			{
				displayName: 'Context Type',
				name: 'contextType',
				type: 'options',
				options: [
					{
						name: 'Process',
						value: 'process',
					},
					{
						name: 'Blueprint',
						value: 'blueprint',
					},
				],
				default: 'process',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
					},
				},
				description: 'Whether to get fields from a process or blueprint',
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
						contextType: ['process'],
					},
				},
				description: 'The ID of the process',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
						contextType: ['blueprint'],
					},
				},
				description: 'The ID of the blueprint',
			},
			{
				displayName: 'Form Field ID',
				name: 'formFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'The ID of the form field (CaptureValue ID)',
			},
			{
				displayName: 'Field Value',
				name: 'fieldValue',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'The value to set for the form field',
			},
			{
				displayName: 'As Guest',
				name: 'asGuest',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'Update as a guest (requires guest email)',
			},
			{
				displayName: 'Guest Email',
				name: 'guestEmail',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						asGuest: [true],
					},
				},
				description: 'Guest email for updating the field',
			},

			// ===== COMMENT FIELDS =====
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'createBot', 'reportProblem', 'resolveIssue'],
					},
				},
				description: 'The ID of the task to comment on',
			},
			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['update', 'delete'],
					},
				},
				description: 'The ID of the comment',
			},
			{
				displayName: 'Comment Content',
				name: 'content',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'createBot', 'reportProblem', 'resolveIssue', 'update'],
					},
				},
				description: 'The comment content (supports HTML)',
			},
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['resolveIssue'],
					},
				},
				description: 'The ID of the issue thread to resolve',
			},

			// ===== USER FIELDS =====
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['get', 'updateRole', 'disable', 'enable', 'convertToGuest'],
					},
				},
				description: 'The ID of the user',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'user@example.com',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Email address of the user to invite',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'First name of the user (max 32 characters)',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Last name of the user (max 32 characters)',
			},
			{
				displayName: 'Role',
				name: 'role',
				type: 'options',
				options: [
					{
						name: 'Admin',
						value: 'admin',
					},
					{
						name: 'Standard',
						value: 'standard',
					},
					{
						name: 'Light',
						value: 'light',
					},
				],
				default: 'standard',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite', 'updateRole'],
					},
				},
				description: 'Role for the user',
			},
			{
				displayName: 'Invitation Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: 'You have been invited to join our Tallyfy organization.',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Message to include in the invitation (max 5000 characters)',
			},

			// ===== GUEST FIELDS =====
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'guest@example.com',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'get', 'update', 'delete', 'convertToMember'],
					},
				},
				description: 'Email address of the guest',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'update'],
					},
				},
				description: 'First name of the guest',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'update'],
					},
				},
				description: 'Last name of the guest',
			},

			// ===== GROUP FIELDS =====
			{
				displayName: 'Group Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create'],
					},
				},
				description: 'Name of the group (must be unique)',
			},
			{
				displayName: 'Group ID',
				name: 'groupId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['get', 'update', 'delete'],
					},
				},
				description: 'The ID of the group',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Description of the group',
			},
			{
				displayName: 'Members',
				name: 'members',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Comma-separated list of user IDs to add to the group',
			},
			{
				displayName: 'Guests',
				name: 'guests',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Comma-separated list of guest emails to add to the group',
			},

			// ===== SEARCH FIELDS =====
			{
				displayName: 'Search Query',
				name: 'searchQuery',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
				description: 'The search query',
			},
			{
				displayName: 'Search In',
				name: 'searchIn',
				type: 'multiOptions',
				options: [
					{
						name: 'Blueprints',
						value: 'blueprint',
					},
					{
						name: 'Processes',
						value: 'process',
					},
					{
						name: 'Tasks',
						value: 'task',
					},
					{
						name: 'Steps',
						value: 'step',
					},
					{
						name: 'Form Fields',
						value: 'capture',
					},
					{
						name: 'Snippets',
						value: 'snippet',
					},
				],
				default: ['blueprint', 'process', 'task'],
				displayOptions: {
					show: {
						resource: ['search'],
						operation: ['global'],
					},
				},
				description: 'What types of resources to search',
			},

			// ===== ID FINDER FIELDS =====
			{
				displayName: 'Search Term',
				name: 'searchTerm',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['idFinder'],
					},
				},
				description: 'Name or search term to find the resource',
			},
			{
				displayName: 'Context',
				name: 'context',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['idFinder'],
						operation: ['findFormFieldId'],
					},
				},
				description: 'Process or Blueprint ID containing the form field',
			},
			{
				displayName: 'Context Type',
				name: 'contextType',
				type: 'options',
				options: [
					{
						name: 'Process',
						value: 'process',
					},
					{
						name: 'Blueprint',
						value: 'blueprint',
					},
				],
				default: 'process',
				displayOptions: {
					show: {
						resource: ['idFinder'],
						operation: ['findFormFieldId'],
					},
				},
				description: 'Type of context for form field search',
			},

			// ===== GENERAL LIST OPERATION FIELDS =====
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['getAll'],
					},
				},
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['getAll'],
						returnAll: [false],
					},
				},
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: {
						operation: ['getAll'],
					},
				},
				options: [
					{
						displayName: 'Search',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Search query',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{
								name: 'Active',
								value: 'active',
							},
							{
								name: 'Completed',
								value: 'completed',
							},
							{
								name: 'Archived',
								value: 'archived',
							},
							{
								name: 'Draft',
								value: 'draft',
							},
						],
						default: 'active',
						description: 'Filter by status',
					},
					{
						displayName: 'Tags',
						name: 'tag',
						type: 'string',
						default: '',
						description: 'Filter by tags (comma-separated)',
					},
					{
						displayName: 'Sort By',
						name: 'sort',
						type: 'options',
						options: [
							{
								name: 'Created Date (Newest)',
								value: '-created_at',
							},
							{
								name: 'Created Date (Oldest)',
								value: 'created_at',
							},
							{
								name: 'Updated Date (Newest)',
								value: '-updated_at',
							},
							{
								name: 'Updated Date (Oldest)',
								value: 'updated_at',
							},
							{
								name: 'Name (A-Z)',
								value: 'name',
							},
							{
								name: 'Name (Z-A)',
								value: '-name',
							},
						],
						default: '-created_at',
						description: 'How to sort results',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);
		const credentials = await this.getCredentials('tallyfyApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://go.tallyfy.com/api';
		const organizationId = credentials.organizationId as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};
				let endpoint = '';
				let method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';
				let body: IDataObject = {};
				let qs: IDataObject = {};

				// Blueprint operations
				if (resource === 'blueprint') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'GET';
					}
					
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'POST';
						
						body.title = this.getNodeParameter('title', i) as string;
						body.type = this.getNodeParameter('type', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'update') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'PUT';
						
						// Title is required for blueprint updates
						body.title = this.getNodeParameter('title', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'delete') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'DELETE';
					}
				}

				// Process operations
				if (resource === 'process') {
					if (operation === 'launch') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'POST';
						
						body.checklist_id = this.getNodeParameter('blueprintId', i) as string;
						body.name = this.getNodeParameter('processName', i) as string;
						
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'PUT';
						
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'archive') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'DELETE';
					}
					
					if (operation === 'getTasks') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks`;
						method = 'GET';
					}
				}

				// Task operations
				if (resource === 'task') {
					if (operation === 'createOneOff') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'POST';
						
						body.title = this.getNodeParameter('title', i) as string;
						body.task_type = this.getNodeParameter('task_type', i) as string;
						body.deadline = this.getNodeParameter('deadline', i) as string;
						
						// Build owners object from additional fields
						body.owners = { users: [], guests: [], groups: [] };
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						
						if (additionalFields.assignUsers) {
							(body.owners as any).users = (additionalFields.assignUsers as string).split(',').map(id => id.trim());
							delete additionalFields.assignUsers;
						}
						if (additionalFields.assignGuests) {
							(body.owners as any).guests = (additionalFields.assignGuests as string).split(',').map(email => email.trim());
							delete additionalFields.assignGuests;
						}
						if (additionalFields.assignGroups) {
							(body.owners as any).groups = (additionalFields.assignGroups as string).split(',').map(id => id.trim());
							delete additionalFields.assignGroups;
						}
						
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'complete') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/completed-tasks`;
						method = 'POST';
						
						body.task_id = taskId;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						if (additionalFields.comment) {
							body.comment = additionalFields.comment;
						}
					}
					
					if (operation === 'updateProperties') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'PUT';
						
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;
						
						// Required fields for task update
						body.title = updateFields.title || this.getNodeParameter('title', i) as string;
						body.deadline = updateFields.deadline || this.getNodeParameter('deadline', i) as string;
						
						// Handle assignee updates - owners is required
						body.owners = { users: [], guests: [], groups: [] };
						
						if (updateFields.assignUsers) {
							(body.owners as any).users = (updateFields.assignUsers as string).split(',').map(id => id.trim());
							delete updateFields.assignUsers;
						}
						if (updateFields.assignGuests) {
							(body.owners as any).guests = (updateFields.assignGuests as string).split(',').map(email => email.trim());
							delete updateFields.assignGuests;
						}
						if (updateFields.assignGroups) {
							(body.owners as any).groups = (updateFields.assignGroups as string).split(',').map(id => id.trim());
							delete updateFields.assignGroups;
						}
						
						// Remove the fields we've already handled
						delete updateFields.title;
						delete updateFields.deadline;
						
						Object.assign(body, updateFields);
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'GET';
					}
					
					if (operation === 'delete') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'DELETE';
					}
					
					if (operation === 'clone') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/clone`;
						method = 'POST';
					}
				}

				// Form Field operations
				if (resource === 'formField') {
					if (operation === 'getFields') {
						const contextType = this.getNodeParameter('contextType', i) as string;
						
						if (contextType === 'process') {
							const processId = this.getNodeParameter('processId', i) as string;
							endpoint = `/organizations/${organizationId}/runs/${processId}/form-fields`;
						} else {
							const blueprintId = this.getNodeParameter('blueprintId', i) as string;
							endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/form-fields`;
						}
						method = 'GET';
					}
					
					if (operation === 'updateValue') {
						const asGuest = this.getNodeParameter('asGuest', i) as boolean;
						const formFieldId = this.getNodeParameter('formFieldId', i) as string;
						const fieldValue = this.getNodeParameter('fieldValue', i) as string;
						
						if (asGuest) {
							const guestEmail = this.getNodeParameter('guestEmail', i) as string;
							endpoint = `/organizations/${organizationId}/guests/${guestEmail}/form-field/value`;
							method = 'POST';
						} else {
							endpoint = `/organizations/${organizationId}/form-field/value`;
							method = 'PUT';
						}
						
						body.id = formFieldId;
						body.form_value = fieldValue;
					}
				}

				// Comment operations
				if (resource === 'comment') {
					const taskId = this.getNodeParameter('taskId', i, '') as string;
					
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'createBot') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/bot-comment`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'reportProblem') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/problem`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'resolveIssue') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/resolved-threads`;
						method = 'POST';
						// Resolve issue requires both thread_id and content
						body.thread_id = this.getNodeParameter('threadId', i) as string;
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'update') {
						const commentId = this.getNodeParameter('commentId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment/${commentId}`;
						method = 'PUT';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'delete') {
						const commentId = this.getNodeParameter('commentId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment/${commentId}`;
						method = 'DELETE';
					}
				}

				// User operations
				if (resource === 'user') {
					if (operation === 'getCurrent') {
						endpoint = '/me';
						method = 'GET';
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/users`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}`;
						method = 'GET';
					}
					
					if (operation === 'invite') {
						endpoint = `/organizations/${organizationId}/users/invite`;
						method = 'POST';
						
						body.email = this.getNodeParameter('email', i) as string;
						body.first_name = this.getNodeParameter('firstName', i) as string;
						body.last_name = this.getNodeParameter('lastName', i) as string;
						body.role = this.getNodeParameter('role', i) as string;
						body.message = this.getNodeParameter('message', i) as string;
					}
					
					if (operation === 'updateRole') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/role`;
						method = 'PUT';
						body.role = this.getNodeParameter('role', i) as string;
					}
					
					if (operation === 'disable') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/disable`;
						method = 'DELETE';
					}
					
					if (operation === 'enable') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/enable`;
						method = 'PUT';
					}
					
					if (operation === 'convertToGuest') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/to/guest`;
						method = 'PUT';
					}
				}

				// Guest operations
				if (resource === 'guest') {
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/guests`;
						method = 'POST';
						
						body.email = this.getNodeParameter('email', i) as string;
						const firstName = this.getNodeParameter('firstName', i, '') as string;
						const lastName = this.getNodeParameter('lastName', i, '') as string;
						if (firstName) body.first_name = firstName;
						if (lastName) body.last_name = lastName;
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/guests`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'PUT';
						
						const firstName = this.getNodeParameter('firstName', i, '') as string;
						const lastName = this.getNodeParameter('lastName', i, '') as string;
						if (firstName) body.first_name = firstName;
						if (lastName) body.last_name = lastName;
					}
					
					if (operation === 'delete') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'DELETE';
					}
					
					if (operation === 'convertToMember') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/to/member`;
						method = 'POST';
					}
				}

				// Group operations
				if (resource === 'group') {
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'POST';
						
						body.name = this.getNodeParameter('name', i) as string;
						body.description = this.getNodeParameter('description', i, '') as string;
						
						const members = this.getNodeParameter('members', i, '') as string;
						const guests = this.getNodeParameter('guests', i, '') as string;
						
						if (members) {
							body.members = members.split(',').map(id => id.trim());
						}
						if (guests) {
							body.guests = guests.split(',').map(email => email.trim());
						}
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'PUT';
						
						const description = this.getNodeParameter('description', i, '') as string;
						const members = this.getNodeParameter('members', i, '') as string;
						const guests = this.getNodeParameter('guests', i, '') as string;
						
						if (description) body.description = description;
						if (members) body.members = members.split(',').map(id => id.trim());
						if (guests) body.guests = guests.split(',').map(email => email.trim());
					}
					
					if (operation === 'delete') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'DELETE';
					}
				}

				// Search operations
				if (resource === 'search') {
					endpoint = `/organizations/${organizationId}/search`;
					method = 'GET';
					
					qs.search = this.getNodeParameter('searchQuery', i) as string;
					
					if (operation === 'global') {
						const searchIn = this.getNodeParameter('searchIn', i) as string[];
						qs.on = searchIn.join(',');
					} else if (operation === 'tasks') {
						qs.on = 'task';
					} else if (operation === 'processes') {
						qs.on = 'process';
					} else if (operation === 'blueprints') {
						qs.on = 'blueprint';
					}
					
					qs.per_page = 50;
				}

				// ID Finder operations
				if (resource === 'idFinder') {
					const searchTerm = this.getNodeParameter('searchTerm', i) as string;
					
					if (operation === 'findProcessId') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findTaskId') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findBlueprintId') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findFormFieldId') {
						const context = this.getNodeParameter('context', i) as string;
						const contextType = this.getNodeParameter('contextType', i) as string;
						
						if (contextType === 'process') {
							endpoint = `/organizations/${organizationId}/runs/${context}/form-fields`;
						} else {
							endpoint = `/organizations/${organizationId}/checklists/${context}/form-fields`;
						}
						method = 'GET';
					}
					
					if (operation === 'findUserId') {
						endpoint = `/organizations/${organizationId}/users`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findGroupId') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
				}

				// Make the API request
				const options: IHttpRequestOptions = {
					method,
					url: `${baseUrl}${endpoint}`,
					headers: {
						'Accept': 'application/json',
						'Content-Type': 'application/json',
					},
					qs,
					body: Object.keys(body).length ? body : undefined,
				};

				responseData = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'tallyfyApi',
					options,
				);

				// Handle pagination if needed
				if (operation === 'getAll' && this.getNodeParameter('returnAll', i)) {
					const allItems: IDataObject[] = [];
					let hasMore = true;
					let page = 1;

					while (hasMore) {
						options.qs = { ...qs, page };
						const pageData = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'tallyfyApi',
							options,
						);

						if (Array.isArray(pageData.data)) {
							allItems.push(...pageData.data);
						}

						if (!pageData.meta?.pagination?.has_more_pages) {
							hasMore = false;
						}
						page++;
					}
					responseData = allItems;
				}

				// Special handling for ID Finder - return simplified results
				if (resource === 'idFinder') {
					let results: any[] = [];
					if (Array.isArray(responseData)) {
						results = responseData;
					} else if (typeof responseData === 'object' && responseData !== null && 'data' in responseData) {
						results = (responseData as IDataObject).data as any[] || [];
					}
					
					if (results.length > 0) {
						responseData = results.map((item: any) => ({
							id: item.id,
							name: item.name || item.title || item.label || item.email || 'Unknown',
							type: operation.replace('find', '').replace('Id', ''),
						}));
					}
				}

				// Format response
				if (Array.isArray(responseData)) {
					returnData.push(...responseData.map(item => ({ json: item })));
				} else {
					returnData.push({ json: responseData });
				}

			} catch (error) {
				if (this.continueOnFail()) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: errorMessage } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}