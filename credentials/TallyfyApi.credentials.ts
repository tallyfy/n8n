import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TallyfyApi implements ICredentialType {
	name = 'tallyfyApi';
	displayName = 'Tallyfy API';
	documentationUrl = 'https://go.tallyfy.com/api/';
	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Your Tallyfy Personal Access Token. Get it from Settings > Integrations > REST API in your Tallyfy account.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://go.tallyfy.com/api',
			description: 'The base URL of the Tallyfy API',
			placeholder: 'https://go.tallyfy.com/api',
		},
		{
			displayName: 'Organization ID',
			name: 'organizationId',
			type: 'string',
			default: '',
			required: true,
			description: 'Your Tallyfy Organization ID. You can find this in your Tallyfy URL (e.g., https://app.tallyfy.com/org/YOUR_ORG_ID)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'Authorization': '=Bearer {{$credentials.accessToken}}',
				'X-Tallyfy-Client': 'n8n',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/me',
			headers: {
				'Accept': 'application/json',
			},
		},
	};
}