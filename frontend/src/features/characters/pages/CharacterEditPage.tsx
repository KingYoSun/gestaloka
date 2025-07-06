import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type FC } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingState } from "@/components/ui/LoadingState";

import { CharacterEditForm } from "../components/CharacterEditForm";
import { useCharacter, useUpdateCharacter } from "@/hooks/useCharacters";

export const CharacterEditPage: FC = () => {
  const { id: characterId } = useParams({ from: "/_authenticated/character/$id/edit" });
  const navigate = useNavigate();
  const { data: character, isLoading, error } = useCharacter(characterId);
  const updateCharacter = useUpdateCharacter();

  const handleSubmit = async (data: {
    name: string;
    description: string;
    appearance: string;
    personality: string;
  }) => {
    try {
      await updateCharacter.mutateAsync({
        characterId,
        updates: {
          name: data.name,
          description: data.description,
          appearance: data.appearance,
          personality: data.personality,
        },
      });
      toast.success("キャラクター情報を更新しました");
      navigate({ to: `/character/${characterId}` });
    } catch {
      toast.error("キャラクター情報の更新に失敗しました");
    }
  };

  const handleCancel = () => {
    navigate({ to: `/character/${characterId}` });
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !character) {
    return (
      <Alert variant="destructive">
        <AlertDescription>キャラクター情報の取得に失敗しました</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate({ to: `/character/${characterId}` })}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          キャラクター詳細に戻る
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>キャラクター編集</CardTitle>
        </CardHeader>
        <CardContent>
          <CharacterEditForm
            character={character}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateCharacter.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
};