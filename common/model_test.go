package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGeminiImageModelsUseImageGenerationEndpoint(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{model: "gemini-3-pro-image", want: true},
		{model: "gemini-3.1-flash-image", want: true},
		{model: "gemini-3-pro", want: false},
		{model: "gemini-3.1-flash", want: false},
	}

	for _, test := range tests {
		t.Run(test.model, func(t *testing.T) {
			assert.Equal(t, test.want, IsImageGenerationModel(test.model))
		})
	}
}
