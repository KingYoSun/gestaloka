# Backend Test Mock Patterns Analysis

## Overview
This analysis categorizes all mock usage patterns found in the backend test suite to help understand testing requirements and common patterns.

## 1. Database Mocks

### 1.1 SQLModel Session Mocks
**Pattern**: Using in-memory SQLite for test sessions
```python
# From conftest.py
@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
```

**Usage Examples**:
- `test_sp_purchase.py`: Tests SP purchase service with real SQLite session
- `api/test_sp.py`: Tests SP endpoints with session injection
- `api/test_log_endpoints.py`: Tests log endpoints with database queries

### 1.2 Query Patterns
**Pattern**: Using SQLModel's select() for queries
```python
# From api/test_sp.py
statement = select(UserModel).where(UserModel.username == "sp_testuser")
result = session.exec(statement)
user = result.first()
```

### 1.3 Neo4j Database Mocks
**Pattern**: Using Neo4j test configuration with cleanup
```python
# From integration/neo4j_conftest.py
@pytest.fixture
def clean_neo4j_db(neo4j_test_config):
    neo_config.DATABASE_URL = neo4j_test_config["url"]
    cleanup_all_neo4j_data()
    yield neo_db
    cleanup_all_neo4j_data()
```

## 2. AI Service Mocks

### 2.1 Gemini Client Mocks
**Pattern**: Mocking LLM responses with AsyncMock
```python
# From test_gemini_client.py
with patch("asyncio.get_event_loop") as mock_loop:
    mock_loop.return_value.run_in_executor = AsyncMock(return_value=mock_response)
```

### 2.2 AI Agent Mocks
**Pattern**: Creating mock agents with predefined responses
```python
# From test_npc_manager_ai.py
gemini_client = MagicMock()
gemini_client.generate = AsyncMock(return_value=MagicMock(content="{}"))
```

**Common Agent Mock Patterns**:
- Mock the `generate_response` method
- Mock the `process` method for agent coordination
- Use MagicMock for synchronous methods
- Use AsyncMock for async methods

### 2.3 Agent Response Mocks
```python
# From test_coordinator.py
agent.process_mock.return_value = AgentResponse(
    agent_role=agent.role.value,
    narrative="Test narrative",
    choices=[],
    state_changes={},
    metadata={}
)
```

## 3. WebSocket/Event Mocks

### 3.1 Event Chain Mocks
**Pattern**: Testing event processing with mock handlers
```python
# From test_event_integration.py
mock_agent = MagicMock()
event_integration.register_agent("dramatist", mock_agent)
```

### 3.2 Event Emission Testing
```python
# Creating and emitting test events
high_priority_event = GameEvent(
    id="high_priority_event",
    type=EventType.PLAYER_DEATH,
    source="test",
    data={"player_id": "test_player"},
    priority=EventPriority.CRITICAL,
)
await event_chain.emit_event(high_priority_event)
```

### 3.3 Async Event Listener Mocks
```python
# From test_shared_context.py
async_listener = AsyncMock()
shared_context.subscribe("test_listener", async_listener)
```

## 4. Model Object Mocks

### 4.1 User Model Mocks
**Pattern**: Creating test users in database
```python
test_user = User(
    id="test-user-id",
    username="testuser",
    email="test@example.com",
    hashed_password="dummy_hash"
)
session.add(test_user)
session.commit()
```

### 4.2 Game Session Mocks
```python
# From test_coordinator.py
session = MagicMock(spec=GameSession)
session.id = "test_session"
session.turn_number = 1
session.character_id = "test_character"
```

### 4.3 NPC Model Mocks
```python
# Creating sample NPC data
sample_npc = NPCCharacterSheet(
    id="test-npc-001",
    name="商人トマス",
    npc_type=NPCType.MERCHANT,
    # ... other fields
)
```

## 5. Common Mock Patterns and Fixtures

### 5.1 Authentication Mocks
**Pattern**: Override FastAPI dependencies
```python
# From api/test_sp.py
def get_test_user():
    # Return test user
    return user

client.app.dependency_overrides[get_current_user] = get_test_user
```

### 5.2 Service Method Mocks
**Pattern**: Using patch decorator
```python
# From test_sp_purchase.py
with patch("app.services.sp_service.SPService.add_sp_sync") as mock_add_sp:
    mock_add_sp.return_value = None
    # Test code
```

### 5.3 Async Method Mocks
**Pattern**: Using AsyncMock for coroutines
```python
# From test_the_world_ai.py
with patch.object(the_world_ai, "_analyze_world_trends", new_callable=AsyncMock):
    # Test async method
```

### 5.4 Configuration Mocks
**Pattern**: Temporarily override settings
```python
# From test_sp_purchase.py
original_mode = settings.PAYMENT_MODE
settings.PAYMENT_MODE = "test"
try:
    # Test code
finally:
    settings.PAYMENT_MODE = original_mode
```

## 6. Test Data Fixtures

### 6.1 Common Test Data
```python
# From conftest.py
@pytest.fixture
def test_user_data():
    return {
        "username": "testuser",
        "email": "test@example.com",
        "password": "TestPassword123!"
    }

@pytest.fixture
def test_character_data():
    return {
        "name": "テストキャラクター",
        "description": "テスト用のキャラクターです",
        # ... other fields
    }
```

## 7. Integration Test Patterns

### 7.1 Database Transaction Handling
- Use real database sessions for integration tests
- Clean up data before and after tests
- Use fixtures for database state management

### 7.2 Neo4j Integration
- Isolated test environment with cleanup
- Track state changes during tests
- Use markers for Neo4j-specific tests

## 8. Mock Best Practices Observed

1. **Type Safety**: Use `spec` parameter in MagicMock to maintain interface
2. **Async Handling**: Use AsyncMock for coroutines, MagicMock for sync
3. **Cleanup**: Always clean up overrides and patches
4. **Isolation**: Each test should be independent
5. **Realistic Data**: Use realistic test data that matches production schemas

## 9. Common Testing Challenges and Solutions

### Challenge: Testing Async AI Coordination
**Solution**: Mock individual agents and test coordination logic separately

### Challenge: Database State Management
**Solution**: Use in-memory SQLite for unit tests, real databases for integration tests

### Challenge: External API Dependencies
**Solution**: Mock at the client level, not the service level

### Challenge: Complex Event Chains
**Solution**: Test individual handlers and chain logic separately

## 10. Recommendations for New Tests

1. **Use Existing Fixtures**: Leverage conftest.py fixtures
2. **Mock at Boundaries**: Mock external services, not internal logic
3. **Test Behavior**: Focus on testing behavior, not implementation
4. **Async-First**: Use async test patterns for async code
5. **Clean State**: Always ensure clean state before and after tests