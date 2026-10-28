"""Small trajectory CNN for the complete pre-decision window; CPU only."""
import torch
from torch import nn
class TrajectoryCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers=nn.Sequential(nn.Conv1d(2,16,5,padding=2),nn.GELU(),nn.Conv1d(16,32,5,padding=2),nn.GELU(),nn.AdaptiveAvgPool1d(1),nn.Flatten(),nn.Linear(32,1))
    def forward(self,x):return self.layers(x.transpose(1,2)).squeeze(1)
