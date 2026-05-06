package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Baseline *BaselineConfig `yaml:"baseline"`
}

type BaselineConfig struct {
	DBPath        string `yaml:"db_path"`
	RetentionDays int    `yaml:"retention_days"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	return &cfg, nil
}

func DefaultConfigPath() string {
	if p := os.Getenv("HO_CONFIG"); p != "" {
		return p
	}
	return "ho.config.yaml"
}
