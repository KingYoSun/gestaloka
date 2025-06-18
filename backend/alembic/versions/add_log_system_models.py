"""add log system models

Revision ID: add_log_system_models
Revises: 52ba950d32b4
Create Date: 2025-06-18 15:47:00

"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'add_log_system_models'
down_revision = '52ba950d32b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create ENUMs if they don't exist
    op.execute("DO $$ BEGIN CREATE TYPE logfragmentrarity AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary'); EXCEPTION WHEN duplicate_object THEN null; END $$")
    op.execute("DO $$ BEGIN CREATE TYPE emotionalvalence AS ENUM ('positive', 'negative', 'neutral'); EXCEPTION WHEN duplicate_object THEN null; END $$")
    op.execute("DO $$ BEGIN CREATE TYPE completedlogstatus AS ENUM ('draft', 'completed', 'contracted', 'active', 'expired', 'recalled'); EXCEPTION WHEN duplicate_object THEN null; END $$")
    op.execute("DO $$ BEGIN CREATE TYPE logcontractstatus AS ENUM ('pending', 'active', 'completed', 'expired', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$")

    # Create log_fragments table
    op.create_table('log_fragments',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('character_id', sa.String(), nullable=False),
        sa.Column('session_id', sa.String(), nullable=False),
        sa.Column('action_description', sa.String(), nullable=False),
        sa.Column('keywords', sa.JSON(), nullable=False),
        sa.Column('emotional_valence', sa.Enum('positive', 'negative', 'neutral', name='emotionalvalence'), nullable=False),
        sa.Column('rarity', sa.Enum('common', 'uncommon', 'rare', 'epic', 'legendary', name='logfragmentrarity'), nullable=False),
        sa.Column('importance_score', sa.Float(), nullable=False),
        sa.Column('context_data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['character_id'], ['characters.id'], ),
        sa.ForeignKeyConstraint(['session_id'], ['game_sessions.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_log_fragments_character_id'), 'log_fragments', ['character_id'], unique=False)
    op.create_index(op.f('ix_log_fragments_session_id'), 'log_fragments', ['session_id'], unique=False)

    # Create completed_logs table
    op.create_table('completed_logs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('creator_id', sa.String(), nullable=False),
        sa.Column('core_fragment_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('description', sa.String(), nullable=False),
        sa.Column('skills', sa.JSON(), nullable=False),
        sa.Column('personality_traits', sa.JSON(), nullable=False),
        sa.Column('behavior_patterns', sa.JSON(), nullable=False),
        sa.Column('contamination_level', sa.Float(), nullable=False),
        sa.Column('status', sa.Enum('draft', 'completed', 'contracted', 'active', 'expired', 'recalled', name='completedlogstatus'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['core_fragment_id'], ['log_fragments.id'], ),
        sa.ForeignKeyConstraint(['creator_id'], ['characters.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_completed_logs_creator_id'), 'completed_logs', ['creator_id'], unique=False)

    # Create completed_log_sub_fragments table
    op.create_table('completed_log_sub_fragments',
        sa.Column('completed_log_id', sa.String(), nullable=False),
        sa.Column('fragment_id', sa.String(), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['completed_log_id'], ['completed_logs.id'], ),
        sa.ForeignKeyConstraint(['fragment_id'], ['log_fragments.id'], ),
        sa.PrimaryKeyConstraint('completed_log_id', 'fragment_id')
    )

    # Create log_contracts table
    op.create_table('log_contracts',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('completed_log_id', sa.String(), nullable=False),
        sa.Column('creator_id', sa.String(), nullable=False),
        sa.Column('host_character_id', sa.String(), nullable=True),
        sa.Column('activity_duration_hours', sa.Integer(), nullable=False),
        sa.Column('behavior_guidelines', sa.String(), nullable=False),
        sa.Column('reward_conditions', sa.JSON(), nullable=False),
        sa.Column('rewards', sa.JSON(), nullable=False),
        sa.Column('is_public', sa.Boolean(), nullable=False),
        sa.Column('price', sa.Integer(), nullable=True),
        sa.Column('status', sa.Enum('pending', 'active', 'completed', 'expired', 'cancelled', name='logcontractstatus'), nullable=False),
        sa.Column('activity_logs', sa.JSON(), nullable=False),
        sa.Column('performance_score', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('activated_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['completed_log_id'], ['completed_logs.id'], ),
        sa.ForeignKeyConstraint(['creator_id'], ['characters.id'], ),
        sa.ForeignKeyConstraint(['host_character_id'], ['characters.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_log_contracts_completed_log_id'), 'log_contracts', ['completed_log_id'], unique=False)
    op.create_index(op.f('ix_log_contracts_creator_id'), 'log_contracts', ['creator_id'], unique=False)
    op.create_index(op.f('ix_log_contracts_host_character_id'), 'log_contracts', ['host_character_id'], unique=False)


def downgrade() -> None:
    # Drop tables
    op.drop_index(op.f('ix_log_contracts_host_character_id'), table_name='log_contracts')
    op.drop_index(op.f('ix_log_contracts_creator_id'), table_name='log_contracts')
    op.drop_index(op.f('ix_log_contracts_completed_log_id'), table_name='log_contracts')
    op.drop_table('log_contracts')
    op.drop_table('completed_log_sub_fragments')
    op.drop_index(op.f('ix_completed_logs_creator_id'), table_name='completed_logs')
    op.drop_table('completed_logs')
    op.drop_index(op.f('ix_log_fragments_session_id'), table_name='log_fragments')
    op.drop_index(op.f('ix_log_fragments_character_id'), table_name='log_fragments')
    op.drop_table('log_fragments')

    # Drop ENUMs if they exist
    op.execute("DROP TYPE IF EXISTS logcontractstatus")
    op.execute("DROP TYPE IF EXISTS completedlogstatus")
    op.execute("DROP TYPE IF EXISTS emotionalvalence")
    op.execute("DROP TYPE IF EXISTS logfragmentrarity")
