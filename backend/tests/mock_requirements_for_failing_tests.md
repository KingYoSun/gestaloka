# Mock Requirements for Failing Tests

Based on the analysis of backend test patterns, here are the common mock requirements that failing tests likely need:

## 1. Database Session Mocks

**Requirement**: Tests need properly configured database sessions
```python
# Required fixture from conftest.py
@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine("sqlite:///:memory:", ...)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
```

**Common Issues**:
- Missing model imports in test files
- Not using session fixture in test parameters
- Transaction not being committed in tests

## 2. AI Service Mocks

**Requirement**: Mock Gemini client responses
```python
# Mock pattern for AI agents
gemini_client = MagicMock()
gemini_client.generate = AsyncMock(return_value=MagicMock(content="{}"))
```

**Common Issues**:
- Not mocking async methods with AsyncMock
- Missing response content structure
- Not setting up prompt_manager mock

## 3. Authentication/Dependency Mocks

**Requirement**: Override FastAPI dependencies
```python
# Required for authenticated endpoints
from app.api.deps import get_current_user

def get_test_user():
    return test_user

client.app.dependency_overrides[get_current_user] = get_test_user
```

**Common Issues**:
- Forgetting to clear dependency overrides
- Not creating test user in session
- Missing authentication headers

## 4. Event/WebSocket Mocks

**Requirement**: Mock event handlers and listeners
```python
# Event handler registration
mock_agent = MagicMock()
event_integration.register_agent("agent_type", mock_agent)

# Async listener
async_listener = AsyncMock()
```

**Common Issues**:
- Not awaiting async event processing
- Missing event handler registration
- Incorrect event priority/type

## 5. Service Integration Mocks

**Requirement**: Mock external service calls
```python
# Example: SP Service mock
with patch("app.services.sp_service.SPService.add_sp_sync") as mock_add_sp:
    mock_add_sp.return_value = None
```

**Common Issues**:
- Patching at wrong level (implementation vs import)
- Not handling async service methods
- Missing return values

## 6. Model Creation Patterns

**Requirement**: Create valid test models
```python
# User model
test_user = User(
    id="test-user-id",
    username="testuser",
    email="test@example.com",
    hashed_password="dummy_hash"
)
session.add(test_user)
session.commit()
```

**Common Issues**:
- Missing required fields
- Not committing to session
- ID conflicts in tests

## 7. Common Fixture Dependencies

Tests often need these fixtures in order:
1. `session` - Database session
2. `test_user` - User model in database
3. `client` - FastAPI test client with session
4. `mock_auth` - Authentication override
5. `auth_headers` - Request headers

## 8. Async Test Patterns

**Requirement**: Proper async test setup
```python
@pytest.mark.asyncio
async def test_async_method():
    # Use await for async calls
    result = await async_method()
```

**Common Issues**:
- Missing @pytest.mark.asyncio decorator
- Not awaiting async calls
- Mixing sync and async incorrectly

## 9. Error Handling Mocks

**Requirement**: Test error scenarios
```python
# Timeout error
mock_loop.return_value.run_in_executor = AsyncMock(side_effect=TimeoutError("Timeout"))

# Rate limit error
with pytest.raises(RetryError):
    await gemini_client.generate(messages)
```

## 10. Neo4j Specific Mocks

**Requirement**: Neo4j test setup
```python
@pytest.mark.neo4j  # Mark test as requiring Neo4j
def test_with_neo4j(clean_neo4j_db):
    # Test with clean Neo4j database
```

**Common Issues**:
- Not using neo4j marker
- Missing cleanup
- Wrong connection configuration

## Debugging Failing Tests Checklist

1. ✓ Check all required fixtures are included
2. ✓ Verify async methods use AsyncMock
3. ✓ Ensure database models are properly created
4. ✓ Check authentication is mocked if needed
5. ✓ Verify all patches are at correct import level
6. ✓ Ensure cleanup in finally blocks
7. ✓ Check for missing await statements
8. ✓ Verify mock return values match expected types
9. ✓ Ensure session commits where needed
10. ✓ Check for proper error handling setup