# JIRA Personal Access Token Integration

This document explains the implementation of JIRA Personal Access Token (PAT) provisioning based on the [Atlassian documentation](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html).

## 🔐 Implementation Overview

Following the official Atlassian PAT documentation, I've implemented comprehensive PAT support that enhances security and workflow automation for the release notes generator.

### Key Features Implemented

**✅ Automatic PAT Detection**

- Detects if `JIRA_PASSWORD` is already a PAT vs traditional password
- Uses Bearer token authentication for PATs (per Atlassian spec)
- Falls back to username/password for older setups

**✅ Interactive PAT Creation**

- Creates PATs via REST API: `POST /rest/pat/latest/tokens`
- Supports configurable expiration (90/180/365 days or never)
- Handles authentication using existing username/password
- Automatically updates `.env` file with new PAT

**✅ Enhanced Error Handling**

- Provides specific guidance for different JIRA versions
- Detects version compatibility (requires JIRA 8.14+)
- Graceful degradation when PATs aren't supported

**✅ Security Best Practices**

- Uses Bearer token authentication: `Authorization: Bearer <token>`
- Tokens are never logged or exposed in output
- Supports token revocation via API
- Configurable expiration dates

## 🛠️ Technical Implementation

### Core Components

1. **`JiraPATManager`** (`src/jira-pat-manager.js`)

   - Implements PAT lifecycle management
   - Handles REST API communication per Atlassian spec
   - Provides interactive setup workflow

2. **Enhanced `JiraClient`** (`src/jira-client.js`)

   - Dual authentication support (PAT vs username/password)
   - Automatic Bearer token usage for PATs
   - Connection testing and PAT suggestions

3. **CLI Integration** (`src/index.js`)
   - New `setup-jira-pat` command
   - Integrated into main workflow
   - Non-intrusive setup process

### API Endpoints Used

Following the Atlassian documentation:

```javascript
// Create PAT
POST {{baseUrl}}/rest/pat/latest/tokens
{
  "name": "Release Notes Generator",
  "expirationDuration": 90
}

// List PATs
GET {{baseUrl}}/rest/pat/latest/tokens

// Revoke PAT
DELETE {{baseUrl}}/rest/pat/latest/tokens/{tokenId}

// Use PAT
Authorization: Bearer <token>
```

## 🚀 Usage Scenarios

### Scenario 1: Fresh Setup

```bash
# User runs setup command
npm start setup-jira-pat

# System guides through:
# 1. Testing current credentials
# 2. Offering PAT creation
# 3. Configuring expiration
# 4. Updating .env file
```

### Scenario 2: Automatic Integration

```bash
# User runs normal generation
npm start generate -r owner/repo

# If JIRA auth fails:
# 1. System detects password authentication
# 2. Suggests PAT setup for better security
# 3. Offers interactive setup
# 4. Continues with updated credentials
```

### Scenario 3: Manual PAT Usage

```bash
# User manually creates PAT in JIRA UI
# Updates .env with: JIRA_PASSWORD=<pat_token>
# System automatically detects and uses Bearer auth
```

## 🔧 Configuration Examples

### Environment Variables

```bash
# Traditional (still supported)
JIRA_HOST=company.atlassian.net
JIRA_USERNAME=john.doe
JIRA_PASSWORD=mypassword123

# PAT-based (recommended)
JIRA_HOST=company.atlassian.net
JIRA_USERNAME=john.doe
JIRA_PASSWORD=ATATTxbZ8xK9V3mBrQ8...  # PAT token
```

### PAT Creation Request

```javascript
const response = await axios.post(
  `${baseUrl}/rest/pat/latest/tokens`,
  {
    name: "Release Notes Generator",
    expirationDuration: 90,
  },
  {
    auth: { username, password },
    headers: { "Content-Type": "application/json" },
  }
);
```

### PAT Usage

```javascript
const response = await axios.get("/rest/api/2/issue/PROJ-123", {
  headers: {
    Authorization: `Bearer ${patToken}`,
    "Content-Type": "application/json",
  },
});
```

## 🎯 Benefits Achieved

**Enhanced Security**

- No password exposure in scripts/logs
- Easy revocation without password changes
- Configurable token expiration

**Better User Experience**

- Interactive setup workflow
- Automatic .env file updates
- Clear error messages and guidance

**Robust Implementation**

- Version detection and compatibility checks
- Graceful fallback to password auth
- Comprehensive error handling

**Compliance with Atlassian Standards**

- Follows official REST API patterns
- Uses recommended Bearer token format
- Implements proper CRUD operations

## 📋 Version Compatibility

Based on Atlassian documentation:

| JIRA Version    | PAT Support         | Implementation              |
| --------------- | ------------------- | --------------------------- |
| Cloud           | ❌ (Use API Tokens) | Falls back to password auth |
| 8.14+ Server/DC | ✅ Full Support     | Full PAT workflow           |
| < 8.14 Server   | ❌                  | Falls back to password auth |

## 🔍 Error Scenarios Handled

- **401 Unauthorized**: Invalid credentials, suggests PAT setup
- **403 Forbidden**: PATs disabled by admin, explains options
- **404 Not Found**: Older JIRA version, provides version guidance
- **Network Issues**: Timeout handling and retry suggestions
- **Invalid PAT Format**: Detection and user guidance

This implementation provides a seamless, secure, and user-friendly way to integrate JIRA PATs into the release notes generation workflow while maintaining full backward compatibility.
